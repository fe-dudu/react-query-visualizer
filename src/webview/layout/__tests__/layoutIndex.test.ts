import { describe, expect, it } from 'vitest';

import { getGraphLayoutIndex, projectLabelForLayoutNode } from '../layoutIndex';
import { createGraph, createGraphNode } from '../../../testing/fixtures';

describe('webview/layout/layoutIndex', () => {
  it('indexes query project ownership and caches by graph reference', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'src/file.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'action',
          kind: 'action',
          label: 'invalidate',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'action-api',
          kind: 'action',
          label: 'invalidateApi',
          resolution: 'static',
          metrics: { projectScope: 'api:packages/core' },
        }),
        createGraphNode({
          id: 'query',
          kind: 'queryKey',
          label: 'todo',
          resolution: 'static',
          metrics: { projectScope: 'api:packages/core' },
        }),
        createGraphNode({
          id: 'declare',
          kind: 'action',
          label: 'declare',
          resolution: 'static',
          metrics: { relation: 'declares', projectScope: 'api:packages/core' },
        }),
        createGraphNode({
          id: 'no-project-action',
          kind: 'action',
          label: 'noProject',
          resolution: 'static',
          metrics: {},
        }),
      ],
      edges: [
        { id: 'missing', source: 'missing', target: 'query', relation: 'invalidates', resolution: 'static' },
        { id: 'e1', source: 'action', target: 'query', relation: 'invalidates', resolution: 'static' },
        { id: 'e2', source: 'action', target: 'query', relation: 'invalidates', resolution: 'static' },
        { id: 'e3', source: 'action-api', target: 'query', relation: 'invalidates', resolution: 'static' },
        { id: 'e4', source: 'action-api', target: 'query', relation: 'invalidates', resolution: 'static' },
        { id: 'e5', source: 'no-project-action', target: 'query', relation: 'invalidates', resolution: 'static' },
      ],
    });

    const index = getGraphLayoutIndex(graph);
    expect(index).toBe(getGraphLayoutIndex(graph));
    expect(index.queryProjectById.get('query')).toBe('api/packages/core');
    expect(index.queryCallsiteImpactById.get('query')).toBe(5);
    expect(index.projectCount).toBe(2);
    const queryNode = graph.nodes[2];
    if (!queryNode) {
      throw new Error('Missing query node');
    }
    expect(projectLabelForLayoutNode(queryNode, index.queryProjectById)).toBe('api/packages/core');
  });

  it('falls back to the node scope label when no query project is inferred', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'action',
          kind: 'action',
          label: 'invalidate',
          resolution: 'static',
          metrics: { projectScope: 'api:packages/core' },
        }),
        createGraphNode({
          id: 'query',
          kind: 'queryKey',
          label: 'todo',
          resolution: 'static',
          metrics: {},
        }),
      ],
      edges: [],
    });

    const index = getGraphLayoutIndex(graph);
    const queryNode = graph.nodes[1];
    if (!queryNode) {
      throw new Error('Missing query node');
    }

    expect(projectLabelForLayoutNode(queryNode, index.queryProjectById)).toBeNull();
    expect(index.projectCount).toBe(1);
  });

  it('skips nodes with unsupported kinds when counting projects', () => {
    // Exercises the `node.kind !== 'file' && node.kind !== 'action' && node.kind !== 'queryKey'` branch.
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'src/file.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
        // Unsupported node kind — should be skipped in the project-count loop.
        {
          id: 'observer',
          kind: 'observer',
          label: 'observer',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        } as never,
      ],
      edges: [],
    });

    const index = getGraphLayoutIndex(graph);
    // Only the 'file' node contributes — 'observer' is skipped.
    expect(index.projectCount).toBe(1);
    expect(index.nodeById.size).toBe(2);
  });
});
