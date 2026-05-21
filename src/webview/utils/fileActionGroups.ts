import type { Node } from '@xyflow/react';

import { isDeclareActionNode } from './utils';
import { getGraphLayoutIndex } from '../layout/layoutIndex';
import { compareActionOrder, fileImpactForNode, projectKeyForNode } from '../layout/layoutNodeMetrics';
import { DEFAULT_NODE_HEIGHT, FILE_ACTION_PROJECT_GAP, resolveVerticalRowGap } from '../layout/spacing';
import type { GraphNode, WebviewPayload } from '../types/model';

export function alignFileActionGroups(nodes: Node[], graph: WebviewPayload['graph'], verticalSpacing: number): Node[] {
  const { nodeById: graphNodeById, queryProjectById } = getGraphLayoutIndex(graph);
  const layoutNodeById = new Map(nodes.map((node) => [node.id, node]));
  const bucketsByProject = new Map<
    string,
    {
      fileIds: string[];
      actionIds: string[];
      queryIds: string[];
    }
  >();
  const actionIdsByFile = new Map<string, string[]>();

  for (const edge of graph.edges) {
    const sourceNode = graphNodeById.get(edge.source);
    const targetNode = graphNodeById.get(edge.target);
    if (!sourceNode || !targetNode || sourceNode.kind !== 'file' || targetNode.kind !== 'action') {
      continue;
    }

    if (isDeclareActionNode(targetNode)) {
      continue;
    }

    if (!layoutNodeById.has(sourceNode.id) || !layoutNodeById.has(targetNode.id)) {
      continue;
    }

    const linkedActions = actionIdsByFile.get(sourceNode.id) ?? [];
    linkedActions.push(targetNode.id);
    actionIdsByFile.set(sourceNode.id, linkedActions);
  }

  for (const graphNode of graph.nodes) {
    if (!layoutNodeById.has(graphNode.id)) {
      continue;
    }

    if (graphNode.kind === 'action' && isDeclareActionNode(graphNode)) {
      continue;
    }

    const project = projectKeyForNode(graphNode, queryProjectById);
    const bucket = bucketsByProject.get(project) ?? {
      fileIds: [],
      actionIds: [],
      queryIds: [],
    };

    if (graphNode.kind === 'file') {
      bucket.fileIds.push(graphNode.id);
    } else if (graphNode.kind === 'action') {
      bucket.actionIds.push(graphNode.id);
    } else if (graphNode.kind === 'queryKey') {
      bucket.queryIds.push(graphNode.id);
    } else {
      continue;
    }

    bucketsByProject.set(project, bucket);
  }

  const projectTop = (project: string): number => {
    const bucket = bucketsByProject.get(project);
    if (!bucket) {
      return Number.POSITIVE_INFINITY;
    }

    const nodeIds = [...bucket.fileIds, ...bucket.actionIds, ...bucket.queryIds];
    return nodeIds.reduce((minY, nodeId) => {
      const y = layoutNodeById.get(nodeId)?.position.y ?? Number.POSITIVE_INFINITY;
      return Math.min(minY, y);
    }, Number.POSITIVE_INFINITY);
  };

  const projectOrder = [...bucketsByProject.keys()].sort((projectA, projectB) => {
    const topA = projectTop(projectA);
    const topB = projectTop(projectB);
    if (topA !== topB) {
      return topA - topB;
    }

    return projectA.localeCompare(projectB);
  });

  const rowNodeIds = nodes
    .map((node) => graphNodeById.get(node.id))
    .filter((graphNode): graphNode is GraphNode => Boolean(graphNode))
    .filter((graphNode) => graphNode.kind === 'file' || graphNode.kind === 'action' || graphNode.kind === 'queryKey')
    .filter((graphNode) => !(graphNode.kind === 'action' && isDeclareActionNode(graphNode)))
    .map((graphNode) => graphNode.id);
  const maxRowNodeHeight = rowNodeIds.reduce((maxHeight, nodeId) => {
    const node = layoutNodeById.get(nodeId);
    if (!node) {
      return maxHeight;
    }

    const nodeHeight = node.measured?.height ?? node.height ?? DEFAULT_NODE_HEIGHT;
    return Math.max(maxHeight, nodeHeight);
  }, DEFAULT_NODE_HEIGHT);
  const rowStep = maxRowNodeHeight + resolveVerticalRowGap(verticalSpacing);

  const yByNodeId = new Map<string, number>();
  let globalCursor = projectOrder.reduce(
    (minY, project) => Math.min(minY, projectTop(project)),
    Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(globalCursor)) {
    globalCursor = 0;
  }

  for (const project of projectOrder) {
    const bucket = bucketsByProject.get(project);
    if (!bucket) {
      continue;
    }

    const sortedActions = [...bucket.actionIds].sort((actionIdA, actionIdB) =>
      compareActionOrder(
        graphNodeById.get(actionIdA),
        graphNodeById.get(actionIdB),
        layoutNodeById.get(actionIdA),
        layoutNodeById.get(actionIdB),
      ),
    );
    const sortedQueries = [...bucket.queryIds].sort((queryIdA, queryIdB) => {
      const queryNodeA = graphNodeById.get(queryIdA);
      const queryNodeB = graphNodeById.get(queryIdB);
      const impactDiff =
        Number(queryNodeB?.metrics?.affectedFiles ?? 0) - Number(queryNodeA?.metrics?.affectedFiles ?? 0);
      if (impactDiff !== 0) {
        return impactDiff;
      }

      const yA = layoutNodeById.get(queryIdA)?.position.y ?? 0;
      const yB = layoutNodeById.get(queryIdB)?.position.y ?? 0;
      if (yA !== yB) {
        return yA - yB;
      }

      const labelA = queryNodeA?.label ?? queryIdA;
      const labelB = queryNodeB?.label ?? queryIdB;
      return labelA.localeCompare(labelB);
    });
    const sortedFiles = [...bucket.fileIds].sort((fileIdA, fileIdB) => {
      const fileNodeA = graphNodeById.get(fileIdA);
      const fileNodeB = graphNodeById.get(fileIdB);
      const impactDiff = fileImpactForNode(fileNodeB) - fileImpactForNode(fileNodeA);
      if (impactDiff !== 0) {
        return impactDiff;
      }

      const yA = layoutNodeById.get(fileIdA)?.position.y ?? 0;
      const yB = layoutNodeById.get(fileIdB)?.position.y ?? 0;
      if (yA !== yB) {
        return yA - yB;
      }

      const labelA = fileNodeA?.label ?? fileIdA;
      const labelB = fileNodeB?.label ?? fileIdB;
      return labelA.localeCompare(labelB);
    });

    const projectStartY = globalCursor;
    const bucketActionSet = new Set(bucket.actionIds);
    const assignedActionIds = new Set<string>();
    let consumedRows = 0;

    for (const fileId of sortedFiles) {
      const linkedActionIds = [...new Set(actionIdsByFile.get(fileId) ?? [])]
        .filter((actionId) => bucketActionSet.has(actionId))
        .filter((actionId) => !assignedActionIds.has(actionId))
        .sort((actionIdA, actionIdB) =>
          compareActionOrder(
            graphNodeById.get(actionIdA),
            graphNodeById.get(actionIdB),
            layoutNodeById.get(actionIdA),
            layoutNodeById.get(actionIdB),
          ),
        );

      const spanRows = Math.max(linkedActionIds.length, 1);
      const fileRow = consumedRows + Math.floor((spanRows - 1) / 2);
      yByNodeId.set(fileId, projectStartY + fileRow * rowStep);

      for (const [actionIndex, actionId] of linkedActionIds.entries()) {
        yByNodeId.set(actionId, projectStartY + (consumedRows + actionIndex) * rowStep);
        assignedActionIds.add(actionId);
      }

      consumedRows += spanRows;
    }

    const orphanActionIds = sortedActions.filter((actionId) => !assignedActionIds.has(actionId));
    for (const actionId of orphanActionIds) {
      yByNodeId.set(actionId, projectStartY + consumedRows * rowStep);
      consumedRows += 1;
    }

    const rowCount = Math.max(consumedRows, sortedQueries.length, 1);
    for (const [rowIndex, queryId] of sortedQueries.entries()) {
      yByNodeId.set(queryId, projectStartY + rowIndex * rowStep);
    }

    globalCursor = projectStartY + (rowCount - 1) * rowStep + maxRowNodeHeight + FILE_ACTION_PROJECT_GAP;
  }

  return nodes.map((node) => {
    const nextY = yByNodeId.get(node.id);
    if (typeof nextY !== 'number') {
      return node;
    }

    return {
      ...node,
      position: {
        x: node.position.x,
        y: nextY,
      },
    };
  });
}
