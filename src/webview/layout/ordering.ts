import type { Node } from '@xyflow/react';

import { getGraphLayoutIndex } from './layoutIndex';
import type { GraphNode, WebviewPayload } from '../types/model';
import { parseProjectScope, projectLabelFromScope } from '../utils/projectScope';
import { isDeclareActionNode } from '../utils/utils';
export function isMonorepoGraph(graph: WebviewPayload['graph']): boolean {
  const packageScopedProjects = new Set<string>();

  for (const node of graph.nodes) {
    if (node.kind !== 'file' && node.kind !== 'action' && node.kind !== 'queryKey') {
      continue;
    }

    const parsed = parseProjectScope(node.metrics?.projectScope);
    if (!parsed) {
      continue;
    }

    // Monorepo-like package scopes typically include nested package paths such as apps/mobile or packages/core.
    if (!parsed.project.includes('/')) {
      continue;
    }

    packageScopedProjects.add(`${parsed.root}:${parsed.project}`);
    if (packageScopedProjects.size > 1) {
      return true;
    }
  }

  return false;
}

function projectKeyForNode(graphNode: GraphNode | undefined, queryProjectById: Map<string, string>): string {
  if (!graphNode) {
    return 'workspace';
  }

  if (graphNode.kind === 'queryKey') {
    return queryProjectById.get(graphNode.id) ?? projectLabelFromScope(graphNode.metrics?.projectScope) ?? 'workspace';
  }

  return projectLabelFromScope(graphNode.metrics?.projectScope) ?? 'workspace';
}

function orderWeightForNode(graphNode: GraphNode | undefined): number {
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

function fileImpactForNode(graphNode: GraphNode | undefined): number {
  if (!graphNode || graphNode.kind !== 'file') {
    return 0;
  }

  return Number(graphNode.metrics?.affectedKeys ?? 0);
}

function queryImpactForNode(graphNode: GraphNode | undefined, queryCallsiteImpactById: Map<string, number>): number {
  if (!graphNode || graphNode.kind !== 'queryKey') {
    return 0;
  }

  return queryCallsiteImpactById.get(graphNode.id) ?? Number(graphNode.metrics?.affectedFiles ?? 0);
}

export function orderNodesForLayout(
  nodes: Node[],
  graph: WebviewPayload['graph'],
  queryCallsiteImpactById: Map<string, number>,
): Node[] {
  const { nodeById: graphNodeById, queryProjectById } = getGraphLayoutIndex(graph);
  const actionImpactById = new Map<string, number>();

  for (const edge of graph.edges) {
    const sourceNode = graphNodeById.get(edge.source);
    const targetNode = graphNodeById.get(edge.target);
    if (!sourceNode || !targetNode || sourceNode.kind !== 'file' || targetNode.kind !== 'action') {
      continue;
    }

    actionImpactById.set(targetNode.id, fileImpactForNode(sourceNode));
  }

  return [...nodes].sort((a, b) => {
    const graphNodeA = graphNodeById.get(a.id);
    const graphNodeB = graphNodeById.get(b.id);

    const projectA = projectKeyForNode(graphNodeA, queryProjectById);
    const projectB = projectKeyForNode(graphNodeB, queryProjectById);
    if (projectA !== projectB) {
      return projectA.localeCompare(projectB);
    }

    const kindA = orderWeightForNode(graphNodeA);
    const kindB = orderWeightForNode(graphNodeB);
    if (kindA !== kindB) {
      return kindA - kindB;
    }

    if (graphNodeA?.kind === 'file' && graphNodeB?.kind === 'file') {
      const impactDiff = fileImpactForNode(graphNodeB) - fileImpactForNode(graphNodeA);
      if (impactDiff !== 0) {
        return impactDiff;
      }
    }

    if (
      graphNodeA?.kind === 'action' &&
      graphNodeB?.kind === 'action' &&
      !isDeclareActionNode(graphNodeA) &&
      !isDeclareActionNode(graphNodeB)
    ) {
      const impactA = actionImpactById.get(graphNodeA.id) ?? 0;
      const impactB = actionImpactById.get(graphNodeB.id) ?? 0;
      if (impactA !== impactB) {
        return impactB - impactA;
      }
    }

    if (graphNodeA?.kind === 'queryKey' && graphNodeB?.kind === 'queryKey') {
      const impactDiff =
        queryImpactForNode(graphNodeB, queryCallsiteImpactById) -
        queryImpactForNode(graphNodeA, queryCallsiteImpactById);
      if (impactDiff !== 0) {
        return impactDiff;
      }
    }

    const labelA = graphNodeA?.label ?? a.id;
    const labelB = graphNodeB?.label ?? b.id;
    return labelA.localeCompare(labelB);
  });
}
