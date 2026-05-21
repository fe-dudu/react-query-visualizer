import type { GraphData, GraphNode } from '../types/model';

function summarizeGroupedResolution(current: GraphNode, next: GraphNode): GraphNode['resolution'] {
  if (current.resolution === 'dynamic' || next.resolution === 'dynamic') {
    return 'dynamic';
  }

  return 'static';
}

function groupedQueryRepresentative(current: GraphNode, next: GraphNode): GraphNode {
  const currentDeclared = Number(current.metrics?.declaredCallsites ?? 0);
  const nextDeclared = Number(next.metrics?.declaredCallsites ?? 0);
  if (currentDeclared !== nextDeclared) {
    return nextDeclared > currentDeclared ? next : current;
  }

  const currentAffected = Number(current.metrics?.affectedFiles ?? 0);
  const nextAffected = Number(next.metrics?.affectedFiles ?? 0);
  if (currentAffected !== nextAffected) {
    return nextAffected > currentAffected ? next : current;
  }

  return next.label.localeCompare(current.label) < 0 ? next : current;
}

export function collapseGraphIfLarge(graph: GraphData, threshold = 800): { graph: GraphData; collapsed: boolean } {
  if (graph.nodes.length <= threshold) {
    return { graph, collapsed: false };
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const groupedQueryNodes = new Map<string, GraphNode>();
  const queryGroupIdByOriginalId = new Map<string, string>();
  const collapsedNodes: GraphNode[] = [];

  for (const node of graph.nodes) {
    if (node.kind !== 'queryKey') {
      collapsedNodes.push(node);
      continue;
    }

    const root = String(node.metrics?.rootSegment ?? 'other');
    const projectScope = typeof node.metrics?.projectScope === 'string' ? node.metrics.projectScope : 'workspace:*';
    const groupId = `qk-group:${projectScope}:${root}`;
    queryGroupIdByOriginalId.set(node.id, groupId);
    const current = groupedQueryNodes.get(groupId);
    const affectedFiles = Number(node.metrics?.affectedFiles ?? 0);

    if (!current) {
      groupedQueryNodes.set(groupId, {
        id: groupId,
        kind: 'queryKey',
        label: node.label,
        resolution: node.resolution,
        metrics: {
          grouped: 1,
          affectedFiles,
          declaredCallsites: Number(node.metrics?.declaredCallsites ?? 0),
          rootSegment: root,
          projectScope,
          representativeQueryNodeId: node.id,
        },
      });
      continue;
    }

    const representative = groupedQueryRepresentative(current, node);
    groupedQueryNodes.set(groupId, {
      ...current,
      label: representative.label,
      metrics: {
        ...current.metrics,
        grouped: Number(current.metrics?.grouped ?? 1) + 1,
        affectedFiles: Number(current.metrics?.affectedFiles ?? 0) + affectedFiles,
        representativeQueryNodeId: representative.id,
      },
      resolution: summarizeGroupedResolution(current, node),
    });
  }

  collapsedNodes.push(...groupedQueryNodes.values());

  const collapsedEdgesMap = new Map<string, GraphData['edges'][number]>();
  for (const edge of graph.edges) {
    let target = edge.target;
    if (nodeById.get(edge.target)?.kind === 'queryKey') {
      target = queryGroupIdByOriginalId.get(edge.target) ?? edge.target;
    }

    const key = `${edge.source}->${target}:${edge.relation}`;
    if (!collapsedEdgesMap.has(key)) {
      collapsedEdgesMap.set(key, {
        ...edge,
        id: key,
        target,
      });
    }
  }

  return {
    collapsed: true,
    graph: {
      ...graph,
      nodes: collapsedNodes,
      edges: [...collapsedEdgesMap.values()],
      summary: {
        ...graph.summary,
        queryKeys: collapsedNodes.filter((node) => node.kind === 'queryKey').length,
      },
    },
  };
}
