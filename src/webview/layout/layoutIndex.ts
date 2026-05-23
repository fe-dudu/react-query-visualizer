import type { GraphNode, WebviewPayload } from '../../shared/contracts';
import { projectLabelFromScope } from '../../shared/path';
import { isDeclareActionNode } from '../utils/utils';

export interface GraphLayoutIndex {
  nodeById: Map<string, GraphNode>;
  queryProjectById: Map<string, string>;
  queryCallsiteImpactById: Map<string, number>;
  projectCount: number;
}

const graphLayoutIndexCache = new WeakMap<WebviewPayload['graph'], GraphLayoutIndex>();

export function projectLabelForLayoutNode(graphNode: GraphNode, queryProjectById: Map<string, string>): string | null {
  if (graphNode.kind === 'queryKey') {
    return queryProjectById.get(graphNode.id) ?? projectLabelFromScope(graphNode.metrics?.projectScope) ?? null;
  }

  return projectLabelFromScope(graphNode.metrics?.projectScope);
}

function buildGraphLayoutIndex(graph: WebviewPayload['graph']): GraphLayoutIndex {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const countsByQuery = new Map<string, Map<string, number>>();
  const queryCallsiteImpactById = new Map<string, number>();

  for (const edge of graph.edges) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode || sourceNode.kind !== 'action' || targetNode.kind !== 'queryKey') {
      continue;
    }

    queryCallsiteImpactById.set(targetNode.id, (queryCallsiteImpactById.get(targetNode.id) ?? 0) + 1);

    const projectLabel = projectLabelFromScope(sourceNode.metrics?.projectScope);
    if (!projectLabel) {
      continue;
    }

    const bucket = countsByQuery.get(targetNode.id) ?? new Map<string, number>();
    bucket.set(projectLabel, (bucket.get(projectLabel) ?? 0) + 1);
    countsByQuery.set(targetNode.id, bucket);
  }

  const projectByQuery = new Map<string, string>();
  for (const [queryNodeId, bucket] of countsByQuery.entries()) {
    const sorted = [...bucket.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const best = sorted[0];
    if (best) {
      projectByQuery.set(queryNodeId, best[0]);
    }
  }

  const projects = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind === 'action' && isDeclareActionNode(node)) {
      continue;
    }

    if (node.kind !== 'file' && node.kind !== 'action' && node.kind !== 'queryKey') {
      continue;
    }

    const label = projectLabelForLayoutNode(node, projectByQuery);
    if (!label) {
      continue;
    }

    projects.add(label);
  }

  return {
    nodeById,
    queryProjectById: projectByQuery,
    queryCallsiteImpactById,
    projectCount: projects.size,
  };
}

export function getGraphLayoutIndex(graph: WebviewPayload['graph']): GraphLayoutIndex {
  const cached = graphLayoutIndexCache.get(graph);
  if (cached) {
    return cached;
  }

  const index = buildGraphLayoutIndex(graph);
  graphLayoutIndexCache.set(graph, index);
  return index;
}
