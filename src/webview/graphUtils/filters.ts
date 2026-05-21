import { isOperationRelation, nodeMatchesSearch, summarizeVisibleGraph } from './shared';
import type { GraphData, GraphEdge, GraphNode } from '../model';
import { nodeFileDisplay } from '../utils';
import type { FilterState } from '../viewTypes';

function updateAllowedIdsForMatchedActions(
  scopedEdges: GraphEdge[],
  nodeById: Map<string, GraphNode>,
  matchedActionIds: Set<string>,
): Set<string> {
  const allowedIds = new Set<string>([...matchedActionIds]);

  for (const edge of scopedEdges) {
    const sourceKind = nodeById.get(edge.source)?.kind;
    const targetKind = nodeById.get(edge.target)?.kind;

    if (matchedActionIds.has(edge.source) && targetKind === 'queryKey') {
      allowedIds.add(edge.target);
    }

    if (matchedActionIds.has(edge.target) && sourceKind === 'file') {
      allowedIds.add(edge.source);
    }
  }

  return allowedIds;
}

export function computeVisibleGraph(graph: GraphData, filters: FilterState): GraphData {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const enabledActionIds = new Set(
    graph.nodes
      .filter((node) => {
        if (node.kind !== 'action') {
          return false;
        }

        const relation = node.metrics?.relation;
        if (!isOperationRelation(relation)) {
          return false;
        }

        return filters.relation[relation];
      })
      .map((node) => node.id),
  );

  if (enabledActionIds.size === 0) {
    return {
      ...graph,
      nodes: [],
      edges: [],
      summary: {
        files: 0,
        actions: 0,
        queryKeys: 0,
        parseErrors: graph.parseErrors.length,
      },
    };
  }

  const candidateEdges = graph.edges.filter((edge) => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode) {
      return false;
    }

    if (sourceNode.kind === 'file' && targetNode.kind === 'action') {
      return enabledActionIds.has(targetNode.id);
    }

    if (sourceNode.kind === 'action' && targetNode.kind === 'queryKey') {
      return enabledActionIds.has(sourceNode.id);
    }

    return false;
  });

  const candidateNodeIds = new Set<string>();
  for (const edge of candidateEdges) {
    candidateNodeIds.add(edge.source);
    candidateNodeIds.add(edge.target);
  }

  let scopedNodes = graph.nodes.filter((node) => candidateNodeIds.has(node.id));
  const scopedIds = new Set(scopedNodes.map((node) => node.id));
  let scopedEdges = candidateEdges.filter((edge) => scopedIds.has(edge.source) && scopedIds.has(edge.target));

  const fileQuery = filters.fileQuery.trim().toLowerCase();
  if (fileQuery.length === 0) {
    const visibleGraph = {
      ...graph,
      nodes: scopedNodes,
      edges: scopedEdges,
    };

    return {
      ...visibleGraph,
      summary: summarizeVisibleGraph(visibleGraph),
    };
  }

  const matchedActionIds = new Set(
    scopedNodes
      .filter((node) => node.kind === 'action' && nodeFileDisplay(node).toLowerCase().includes(fileQuery))
      .map((node) => node.id),
  );

  const matchedFileIds = new Set(
    scopedNodes
      .filter((node) => node.kind === 'file' && node.label.toLowerCase().includes(fileQuery))
      .map((node) => node.id),
  );

  for (const edge of scopedEdges) {
    if (matchedFileIds.has(edge.source) && nodeById.get(edge.target)?.kind === 'action') {
      matchedActionIds.add(edge.target);
    }
  }

  const allowedIds = updateAllowedIdsForMatchedActions(scopedEdges, nodeById, matchedActionIds);
  scopedEdges = scopedEdges.filter((edge) => allowedIds.has(edge.source) && allowedIds.has(edge.target));
  scopedNodes = scopedNodes.filter((node) => allowedIds.has(node.id));

  const visibleGraph = {
    ...graph,
    nodes: scopedNodes,
    edges: scopedEdges,
  };

  return {
    ...visibleGraph,
    summary: summarizeVisibleGraph(visibleGraph),
  };
}

export function applySearchFilter(graph: GraphData, search: string): GraphData {
  const searchText = search.trim().toLowerCase();
  if (searchText.length === 0) {
    return graph;
  }

  const matchedNodeIds = new Set(
    graph.nodes.filter((node) => nodeMatchesSearch(node, searchText)).map((node) => node.id),
  );
  if (matchedNodeIds.size === 0) {
    return {
      ...graph,
      nodes: [],
      edges: [],
      summary: {
        files: 0,
        actions: 0,
        queryKeys: 0,
        parseErrors: graph.parseErrors.length,
      },
    };
  }

  const edgesByNodeId = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    const sourceList = edgesByNodeId.get(edge.source) ?? [];
    sourceList.push(edge);
    edgesByNodeId.set(edge.source, sourceList);

    const targetList = edgesByNodeId.get(edge.target) ?? [];
    targetList.push(edge);
    edgesByNodeId.set(edge.target, targetList);
  }

  // Keep direct matches and nearby context (file-action-query chain) to avoid isolated nodes.
  const allowedNodeIds = new Set<string>(matchedNodeIds);
  let frontier = [...matchedNodeIds];

  for (let depth = 0; depth < 2; depth += 1) {
    if (frontier.length === 0) {
      break;
    }

    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      const linkedEdges = edgesByNodeId.get(nodeId) ?? [];
      for (const edge of linkedEdges) {
        const neighborId = edge.source === nodeId ? edge.target : edge.source;
        if (allowedNodeIds.has(neighborId)) {
          continue;
        }

        allowedNodeIds.add(neighborId);
        nextFrontier.push(neighborId);
      }
    }

    frontier = nextFrontier;
  }

  const scopedNodes = graph.nodes.filter((node) => allowedNodeIds.has(node.id));
  const scopedNodeIds = new Set(scopedNodes.map((node) => node.id));
  const scopedEdges = graph.edges.filter((edge) => scopedNodeIds.has(edge.source) && scopedNodeIds.has(edge.target));
  const visibleGraph = {
    ...graph,
    nodes: scopedNodes,
    edges: scopedEdges,
  };

  return {
    ...visibleGraph,
    summary: summarizeVisibleGraph(visibleGraph),
  };
}
