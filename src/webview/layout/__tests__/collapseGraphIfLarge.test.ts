import { describe, expect, it } from 'vitest';

import { collapseGraphIfLarge } from '../collapseGraphIfLarge';
import { createGraph, createGraphEdge, createGraphNode } from '../../../testing/fixtures';

describe('webview/layout/collapseGraphIfLarge', () => {
  it('collapses repeated query nodes by project and root', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({ id: 'file', kind: 'file', label: 'src/file.ts', resolution: 'static' }),
        createGraphNode({ id: 'action', kind: 'action', label: 'invalidate', resolution: 'static' }),
        createGraphNode({
          id: 'q1',
          kind: 'queryKey',
          label: 'todo',
          resolution: 'static',
          metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', declaredCallsites: 1, affectedFiles: 2 },
        }),
        createGraphNode({
          id: 'q2',
          kind: 'queryKey',
          label: 'todo list',
          resolution: 'dynamic',
          metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', declaredCallsites: 3, affectedFiles: 5 },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'e1', source: 'file', target: 'action', relation: 'invalidates' }),
        createGraphEdge({ id: 'e2', source: 'action', target: 'q1', relation: 'invalidates' }),
        createGraphEdge({ id: 'e3', source: 'action', target: 'q2', relation: 'invalidates' }),
      ],
      summary: { files: 1, actions: 1, queryKeys: 2, parseErrors: 0 },
    });

    const collapsed = collapseGraphIfLarge(graph, 3);
    expect(collapsed.collapsed).toBe(true);
    expect(collapsed.graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'qk-group:web:apps/web:todo', kind: 'queryKey', resolution: 'dynamic' }),
      ]),
    );
    expect(collapsed.graph.summary.queryKeys).toBe(1);
    expect(collapseGraphIfLarge(graph, 99).collapsed).toBe(false);
  });

  it('keeps the most representative grouped node and deduplicates collapsed edges', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({ id: 'file', kind: 'file', label: 'src/file.ts', resolution: 'static' }),
        createGraphNode({
          id: 'action-a',
          kind: 'action',
          label: 'invalidateA',
          resolution: 'static',
        }),
        createGraphNode({
          id: 'action-b',
          kind: 'action',
          label: 'invalidateB',
          resolution: 'static',
        }),
        createGraphNode({
          id: 'query-a',
          kind: 'queryKey',
          label: 'beta',
          resolution: 'static',
          metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', declaredCallsites: 2, affectedFiles: 1 },
        }),
        createGraphNode({
          id: 'query-b',
          kind: 'queryKey',
          label: 'alpha',
          resolution: 'dynamic',
          metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', declaredCallsites: 2, affectedFiles: 1 },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'file-action-a', source: 'file', target: 'action-a', relation: 'invalidates' }),
        createGraphEdge({ id: 'file-action-b', source: 'file', target: 'action-b', relation: 'invalidates' }),
        createGraphEdge({ id: 'action-a-query-a', source: 'action-a', target: 'query-a', relation: 'invalidates' }),
        createGraphEdge({ id: 'action-b-query-a', source: 'action-b', target: 'query-a', relation: 'invalidates' }),
        createGraphEdge({ id: 'action-a-query-b', source: 'action-a', target: 'query-b', relation: 'invalidates' }),
      ],
      summary: { files: 1, actions: 2, queryKeys: 2, parseErrors: 0 },
    });

    const collapsed = collapseGraphIfLarge(graph, 4);
    expect(collapsed.collapsed).toBe(true);
    const queryNode = collapsed.graph.nodes.find((node) => node.kind === 'queryKey');
    expect(queryNode).toMatchObject({
      label: 'alpha',
      resolution: 'dynamic',
      metrics: expect.objectContaining({
        grouped: 2,
        affectedFiles: 2,
        representativeQueryNodeId: 'query-b',
      }),
    });
    expect(collapsed.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'file->action-a:invalidates', target: 'action-a' }),
        expect.objectContaining({
          id: 'action-a->qk-group:web:apps/web:todo:invalidates',
          target: 'qk-group:web:apps/web:todo',
        }),
      ]),
    );
    expect(collapsed.graph.summary.queryKeys).toBe(1);
  });

  it('uses affected-file and fallback metrics when grouping static queries', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({ id: 'action', kind: 'action', label: 'invalidate', resolution: 'static' }),
        createGraphNode({
          id: 'query-low',
          kind: 'queryKey',
          label: 'low',
          resolution: 'static',
          metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', affectedFiles: 1 },
        }),
        createGraphNode({
          id: 'query-high',
          kind: 'queryKey',
          label: 'high',
          resolution: 'static',
          metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', affectedFiles: 3 },
        }),
        createGraphNode({
          id: 'query-fallback-a',
          kind: 'queryKey',
          label: 'fallback-a',
          resolution: 'static',
          metrics: {},
        }),
        createGraphNode({
          id: 'query-fallback-b',
          kind: 'queryKey',
          label: 'fallback-b',
          resolution: 'static',
          metrics: {},
        }),
        createGraphNode({
          id: 'query-current-high',
          kind: 'queryKey',
          label: 'current-high',
          resolution: 'static',
          metrics: { rootSegment: 'user', projectScope: 'web:apps/web', declaredCallsites: 0, affectedFiles: 4 },
        }),
        createGraphNode({
          id: 'query-current-low',
          kind: 'queryKey',
          label: 'current-low',
          resolution: 'static',
          metrics: { rootSegment: 'user', projectScope: 'web:apps/web', declaredCallsites: 0, affectedFiles: 1 },
        }),
        createGraphNode({
          id: 'query-declared-high',
          kind: 'queryKey',
          label: 'declared-high',
          resolution: 'static',
          metrics: { rootSegment: 'post', projectScope: 'web:apps/web', declaredCallsites: 3, affectedFiles: 1 },
        }),
        createGraphNode({
          id: 'query-declared-low',
          kind: 'queryKey',
          label: 'declared-low',
          resolution: 'static',
          metrics: { rootSegment: 'post', projectScope: 'web:apps/web', declaredCallsites: 1, affectedFiles: 9 },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'high', source: 'action', target: 'query-high', relation: 'invalidates' }),
        createGraphEdge({ id: 'low', source: 'action', target: 'query-low', relation: 'invalidates' }),
        createGraphEdge({ id: 'fallback-a', source: 'action', target: 'query-fallback-a', relation: 'invalidates' }),
        createGraphEdge({ id: 'fallback-b', source: 'action', target: 'query-fallback-b', relation: 'invalidates' }),
        createGraphEdge({
          id: 'current-high',
          source: 'action',
          target: 'query-current-high',
          relation: 'invalidates',
        }),
        createGraphEdge({ id: 'current-low', source: 'action', target: 'query-current-low', relation: 'invalidates' }),
        createGraphEdge({
          id: 'declared-high',
          source: 'action',
          target: 'query-declared-high',
          relation: 'invalidates',
        }),
        createGraphEdge({
          id: 'declared-low',
          source: 'action',
          target: 'query-declared-low',
          relation: 'invalidates',
        }),
      ],
      summary: { files: 0, actions: 1, queryKeys: 4, parseErrors: 0 },
    });

    const collapsed = collapseGraphIfLarge(graph, 1);
    const queryNodes = collapsed.graph.nodes.filter((node) => node.kind === 'queryKey');
    expect(queryNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'qk-group:web:apps/web:todo',
          label: 'high',
          resolution: 'static',
          metrics: expect.objectContaining({ affectedFiles: 4, representativeQueryNodeId: 'query-high' }),
        }),
        expect.objectContaining({
          id: 'qk-group:workspace:*:other',
          metrics: expect.objectContaining({ affectedFiles: 0, declaredCallsites: 0, grouped: 2 }),
        }),
        expect.objectContaining({
          id: 'qk-group:web:apps/web:user',
          metrics: expect.objectContaining({ representativeQueryNodeId: 'qk-group:web:apps/web:user' }),
        }),
        expect.objectContaining({
          id: 'qk-group:web:apps/web:post',
          metrics: expect.objectContaining({ representativeQueryNodeId: 'qk-group:web:apps/web:post' }),
        }),
      ]),
    );
  });
});
