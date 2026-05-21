import type { Node } from '@xyflow/react';

import { getGraphLayoutIndex } from './layoutIndex';
import { projectKeyForNode } from './layoutNodeMetrics';
import { DECLARE_ACTION_QUERY_GAP, DEFAULT_NODE_HEIGHT, resolveVerticalRowGap } from './spacing';
import type { GraphNode, WebviewPayload } from '../types/model';
import { isDeclareActionNode } from '../utils/utils';

export function alignQueryNodesNearSources(
  nodes: Node[],
  graph: WebviewPayload['graph'],
  queryCallsiteImpactById: Map<string, number>,
  verticalSpacing: number,
): Node[] {
  const { nodeById: graphNodeById, queryProjectById } = getGraphLayoutIndex(graph);
  const layoutNodeById = new Map(nodes.map((node) => [node.id, node]));
  const queryIdsByProject = new Map<string, string[]>();
  const projectNodeIdsByProject = new Map<string, string[]>();
  const actionIdsByQuery = new Map<string, string[]>();

  for (const edge of graph.edges) {
    const sourceNode = graphNodeById.get(edge.source);
    const targetNode = graphNodeById.get(edge.target);
    if (!sourceNode || !targetNode) {
      continue;
    }

    if (sourceNode.kind !== 'action' || isDeclareActionNode(sourceNode) || targetNode.kind !== 'queryKey') {
      continue;
    }

    if (!layoutNodeById.has(sourceNode.id) || !layoutNodeById.has(targetNode.id)) {
      continue;
    }

    const list = actionIdsByQuery.get(targetNode.id) ?? [];
    list.push(sourceNode.id);
    actionIdsByQuery.set(targetNode.id, list);
  }

  for (const graphNode of graph.nodes) {
    if (!layoutNodeById.has(graphNode.id)) {
      continue;
    }

    if (graphNode.kind === 'action' && isDeclareActionNode(graphNode)) {
      continue;
    }

    if (graphNode.kind !== 'file' && graphNode.kind !== 'action' && graphNode.kind !== 'queryKey') {
      continue;
    }

    const project = projectKeyForNode(graphNode, queryProjectById);
    const projectNodeIds = projectNodeIdsByProject.get(project) ?? [];
    projectNodeIds.push(graphNode.id);
    projectNodeIdsByProject.set(project, projectNodeIds);

    if (graphNode.kind !== 'queryKey') {
      continue;
    }

    const queryIds = queryIdsByProject.get(project) ?? [];
    queryIds.push(graphNode.id);
    queryIdsByProject.set(project, queryIds);
  }

  if (queryIdsByProject.size === 0) {
    return nodes;
  }

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

  for (const [project, projectQueryIds] of queryIdsByProject.entries()) {
    const projectNodeIds = projectNodeIdsByProject.get(project) ?? [];
    if (projectNodeIds.length === 0 || projectQueryIds.length === 0) {
      continue;
    }

    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const nodeId of projectNodeIds) {
      const y = layoutNodeById.get(nodeId)?.position.y;
      if (typeof y !== 'number') {
        continue;
      }
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
      continue;
    }

    const queryIds = [...new Set(projectQueryIds)].sort((queryIdA, queryIdB) => {
      const actionCountDiff =
        (actionIdsByQuery.get(queryIdB)?.length ?? 0) - (actionIdsByQuery.get(queryIdA)?.length ?? 0);
      if (actionCountDiff !== 0) {
        return actionCountDiff;
      }

      const impactDiff = (queryCallsiteImpactById.get(queryIdB) ?? 0) - (queryCallsiteImpactById.get(queryIdA) ?? 0);
      if (impactDiff !== 0) {
        return impactDiff;
      }

      const yA = layoutNodeById.get(queryIdA)?.position.y ?? 0;
      const yB = layoutNodeById.get(queryIdB)?.position.y ?? 0;
      if (yA !== yB) {
        return yA - yB;
      }

      const labelA = graphNodeById.get(queryIdA)?.label ?? queryIdA;
      const labelB = graphNodeById.get(queryIdB)?.label ?? queryIdB;
      return labelA.localeCompare(labelB);
    });

    const projectRowSpan = Math.max(1, Math.round((maxY - minY) / rowStep) + 1);
    const rowCount = Math.max(projectRowSpan, queryIds.length);
    const availableRows = new Set<number>(Array.from({ length: rowCount }, (_, index) => index));
    const clampRow = (value: number): number => Math.max(0, Math.min(rowCount - 1, value));
    const rowFromY = (value: number): number => clampRow(Math.round((value - minY) / rowStep));

    for (const queryId of queryIds) {
      const sourceActionIds = actionIdsByQuery.get(queryId) ?? [];
      const sourceActionYs = [...new Set(sourceActionIds)]
        .map((actionId) => layoutNodeById.get(actionId)?.position.y)
        .filter((value): value is number => typeof value === 'number')
        .sort((a, b) => a - b);
      const currentQueryY = layoutNodeById.get(queryId)?.position.y ?? minY;
      const preferredY =
        sourceActionYs.length > 0
          ? (sourceActionYs[Math.floor(sourceActionYs.length / 2)] ?? currentQueryY)
          : currentQueryY;
      const preferredRow = rowFromY(preferredY);

      let selectedRow = preferredRow;
      let selectedDistance = Number.POSITIVE_INFINITY;
      for (const rowIndex of availableRows) {
        const distance = Math.abs(rowIndex - preferredRow);
        if (distance < selectedDistance || (distance === selectedDistance && rowIndex < selectedRow)) {
          selectedRow = rowIndex;
          selectedDistance = distance;
        }
      }

      if (availableRows.has(selectedRow)) {
        availableRows.delete(selectedRow);
      }

      yByNodeId.set(queryId, minY + selectedRow * rowStep);
    }
  }

  if (yByNodeId.size === 0) {
    return nodes;
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

export function alignQueryNodesToRightColumn(
  nodes: Node[],
  graph: WebviewPayload['graph'],
  groupByProject = false,
): Node[] {
  const { nodeById: graphNodeById, queryProjectById } = getGraphLayoutIndex(graph);

  if (groupByProject) {
    const boundsByProject = new Map<
      string,
      {
        rightMostNonQueryRight: number;
        rightMostQueryX: number;
      }
    >();

    for (const node of nodes) {
      const graphNode = graphNodeById.get(node.id);
      if (!graphNode) {
        continue;
      }

      const project = projectKeyForNode(graphNode, queryProjectById);
      const bucket = boundsByProject.get(project) ?? {
        rightMostNonQueryRight: Number.NEGATIVE_INFINITY,
        rightMostQueryX: Number.NEGATIVE_INFINITY,
      };

      const nodeWidth = node.measured?.width ?? node.width ?? 340;
      const nodeRight = node.position.x + nodeWidth;

      if (graphNode.kind === 'queryKey') {
        bucket.rightMostQueryX = Math.max(bucket.rightMostQueryX, node.position.x);
      } else {
        bucket.rightMostNonQueryRight = Math.max(bucket.rightMostNonQueryRight, nodeRight);
      }

      boundsByProject.set(project, bucket);
    }

    const targetXByProject = new Map<string, number>();
    for (const [project, bounds] of boundsByProject.entries()) {
      if (!Number.isFinite(bounds.rightMostQueryX)) {
        continue;
      }

      const targetX = Number.isFinite(bounds.rightMostNonQueryRight)
        ? Math.max(bounds.rightMostQueryX, bounds.rightMostNonQueryRight + DECLARE_ACTION_QUERY_GAP)
        : bounds.rightMostQueryX;
      targetXByProject.set(project, targetX);
    }

    if (targetXByProject.size === 0) {
      return nodes;
    }

    return nodes.map((node) => {
      const graphNode = graphNodeById.get(node.id);
      if (!graphNode || graphNode.kind !== 'queryKey') {
        return node;
      }

      const project = projectKeyForNode(graphNode, queryProjectById);
      const nextX = targetXByProject.get(project);
      if (typeof nextX !== 'number') {
        return node;
      }

      return {
        ...node,
        position: {
          x: nextX,
          y: node.position.y,
        },
      };
    });
  }

  let rightMostNonQueryRight = Number.NEGATIVE_INFINITY;
  let rightMostQueryX = Number.NEGATIVE_INFINITY;
  let hasQueryNode = false;

  for (const node of nodes) {
    const graphNode = graphNodeById.get(node.id);
    if (!graphNode) {
      continue;
    }

    const nodeWidth = node.measured?.width ?? node.width ?? 340;
    const nodeRight = node.position.x + nodeWidth;

    if (graphNode.kind === 'queryKey') {
      hasQueryNode = true;
      rightMostQueryX = Math.max(rightMostQueryX, node.position.x);
      continue;
    }

    rightMostNonQueryRight = Math.max(rightMostNonQueryRight, nodeRight);
  }

  if (!hasQueryNode) {
    return nodes;
  }

  const targetQueryX = Number.isFinite(rightMostNonQueryRight)
    ? Math.max(rightMostQueryX, rightMostNonQueryRight + DECLARE_ACTION_QUERY_GAP)
    : rightMostQueryX;

  return nodes.map((node) => {
    const graphNode = graphNodeById.get(node.id);
    if (!graphNode || graphNode.kind !== 'queryKey') {
      return node;
    }

    return {
      ...node,
      position: {
        x: targetQueryX,
        y: node.position.y,
      },
    };
  });
}

export function alignDeclareNodesLeftOfQuery(nodes: Node[], graph: WebviewPayload['graph']): Node[] {
  const { nodeById: graphNodeById } = getGraphLayoutIndex(graph);
  const layoutNodeById = new Map(nodes.map((node) => [node.id, node]));
  const nextXById = new Map<string, number>();

  for (const edge of graph.edges) {
    if (edge.relation !== 'declares') {
      continue;
    }

    const sourceGraphNode = graphNodeById.get(edge.source);
    const targetGraphNode = graphNodeById.get(edge.target);
    if (
      !sourceGraphNode ||
      !targetGraphNode ||
      !isDeclareActionNode(sourceGraphNode) ||
      targetGraphNode.kind !== 'queryKey'
    ) {
      continue;
    }

    const actionNode = layoutNodeById.get(sourceGraphNode.id);
    const queryNode = layoutNodeById.get(targetGraphNode.id);
    if (!actionNode || !queryNode) {
      continue;
    }

    const actionWidth = actionNode.measured?.width ?? actionNode.width ?? 340;
    const desiredX = queryNode.position.x - actionWidth - DECLARE_ACTION_QUERY_GAP;
    const currentX = nextXById.get(sourceGraphNode.id) ?? actionNode.position.x;
    nextXById.set(sourceGraphNode.id, Math.min(currentX, desiredX));
  }

  if (nextXById.size === 0) {
    return nodes;
  }

  return nodes.map((node) => {
    const nextX = nextXById.get(node.id);
    if (typeof nextX !== 'number') {
      return node;
    }

    return {
      ...node,
      position: {
        x: nextX,
        y: node.position.y,
      },
    };
  });
}
