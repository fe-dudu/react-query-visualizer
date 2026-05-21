import type { Node } from '@xyflow/react';

import { projectLabelFromScope } from '../utils/projectScope';
import type { GraphNode } from '../types/model';
import { isDeclareActionNode } from '../utils/utils';

export function projectKeyForNode(graphNode: GraphNode | undefined, queryProjectById: Map<string, string>): string {
  if (!graphNode) {
    return 'workspace';
  }

  if (graphNode.kind === 'queryKey') {
    return queryProjectById.get(graphNode.id) ?? projectLabelFromScope(graphNode.metrics?.projectScope) ?? 'workspace';
  }

  return projectLabelFromScope(graphNode.metrics?.projectScope) ?? 'workspace';
}

export function orderWeightForNode(graphNode: GraphNode | undefined): number {
  if (!graphNode) {
    return 2;
  }

  if (graphNode.kind === 'file') {
    return 0;
  }

  if (graphNode.kind === 'action') {
    if (isDeclareActionNode(graphNode)) {
      return 3;
    }
    return 1;
  }

  return 2;
}

export function fileImpactForNode(graphNode: GraphNode | undefined): number {
  if (!graphNode || graphNode.kind !== 'file') {
    return 0;
  }

  return Number(graphNode.metrics?.affectedKeys ?? 0);
}

export function queryImpactForNode(
  graphNode: GraphNode | undefined,
  queryCallsiteImpactById: Map<string, number>,
): number {
  if (!graphNode || graphNode.kind !== 'queryKey') {
    return 0;
  }

  return queryCallsiteImpactById.get(graphNode.id) ?? Number(graphNode.metrics?.affectedFiles ?? 0);
}

export function compareActionOrder(
  actionA: GraphNode | undefined,
  actionB: GraphNode | undefined,
  fallbackA: Node | undefined,
  fallbackB: Node | undefined,
): number {
  const lineA = actionA?.loc?.line ?? Number.POSITIVE_INFINITY;
  const lineB = actionB?.loc?.line ?? Number.POSITIVE_INFINITY;
  if (lineA !== lineB) {
    return lineA - lineB;
  }

  const columnA = actionA?.loc?.column ?? Number.POSITIVE_INFINITY;
  const columnB = actionB?.loc?.column ?? Number.POSITIVE_INFINITY;
  if (columnA !== columnB) {
    return columnA - columnB;
  }

  const yA = fallbackA?.position.y ?? 0;
  const yB = fallbackB?.position.y ?? 0;
  if (yA !== yB) {
    return yA - yB;
  }

  const labelA = actionA?.label ?? fallbackA?.id ?? '';
  const labelB = actionB?.label ?? fallbackB?.id ?? '';
  return labelA.localeCompare(labelB);
}
