import type { Node } from '@xyflow/react';

import { getGraphLayoutIndex } from './layoutIndex';
import { fileImpactForNode, orderWeightForNode, projectKeyForNode, queryImpactForNode } from './layoutNodeMetrics';
import type { WebviewPayload } from '../types/model';
import { isDeclareActionNode } from '../utils/utils';

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
