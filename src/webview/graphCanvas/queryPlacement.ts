import type { Node } from '@xyflow/react';

import { getGraphLayoutIndex } from './layoutIndex';
import { projectKeyForNode } from './layoutNodeMetrics';
import { DECLARE_ACTION_QUERY_GAP } from './spacing';
import type { WebviewPayload } from '../model';
import { isDeclareActionNode } from '../utils';

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
