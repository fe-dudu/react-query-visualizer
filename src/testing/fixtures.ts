import type { GraphData, GraphEdge, GraphNode, QueryRecord, ScannedFile } from '../shared/contracts';

export function createGraphNode(overrides: Partial<GraphNode> & Pick<GraphNode, 'id' | 'kind' | 'label'>): GraphNode {
  return {
    resolution: 'static',
    ...overrides,
  };
}

export function createGraphEdge(
  overrides: Partial<GraphEdge> & Pick<GraphEdge, 'id' | 'source' | 'target' | 'relation'>,
): GraphEdge {
  return {
    resolution: 'static',
    ...overrides,
  };
}

export function createGraph(overrides: Partial<GraphData> & Pick<GraphData, 'nodes' | 'edges'>): GraphData {
  return {
    summary: {
      files: 0,
      actions: 0,
      queryKeys: 0,
      parseErrors: 0,
    },
    parseErrors: [],
    ...overrides,
  };
}

export function createQueryRecord(
  overrides: Partial<QueryRecord> & Pick<QueryRecord, 'relation' | 'operation' | 'file' | 'loc' | 'queryKey'>,
): QueryRecord {
  return {
    resolution: 'static',
    ...overrides,
  };
}

export function createScannedFile(
  overrides: Partial<ScannedFile> & Pick<ScannedFile, 'path' | 'workspace' | 'depth'>,
): ScannedFile {
  return {
    ...overrides,
  };
}
