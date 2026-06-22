import { describe, expect, it } from 'vitest';

import { applySearchFilter, computeVisibleGraph } from '../filters';
import { createGraph, createGraphEdge, createGraphNode } from '../../../testing/fixtures';

describe('webview/utils/filters', () => {
  const graph = createGraph({
    nodes: [
      createGraphNode({ id: 'file', kind: 'file', label: 'src/file.ts', resolution: 'static' }),
      createGraphNode({
        id: 'action',
        kind: 'action',
        label: 'invalidate',
        file: 'src/file.ts',
        resolution: 'static',
        metrics: { relation: 'invalidates', displayFile: 'src/file.ts' },
      }),
      createGraphNode({ id: 'query', kind: 'queryKey', label: 'todo', resolution: 'static' }),
      createGraphNode({
        id: 'other-action',
        kind: 'action',
        label: 'skip',
        file: 'src/other.ts',
        resolution: 'static',
        metrics: { relation: 'sets', displayFile: 'src/other.ts' },
      }),
    ],
    edges: [
      createGraphEdge({ id: 'e1', source: 'file', target: 'action', relation: 'invalidates' }),
      createGraphEdge({ id: 'e2', source: 'action', target: 'query', relation: 'invalidates' }),
      createGraphEdge({ id: 'e3', source: 'file', target: 'other-action', relation: 'sets' }),
    ],
  });

  const filters = {
    relation: {
      invalidates: true,
      sets: false,
      refetches: false,
      cancels: false,
      resets: false,
      removes: false,
      clears: false,
    },
    fileQuery: '',
    search: '',
  };

  it('filters graph by relation and search text', () => {
    const visible = computeVisibleGraph(graph, filters);
    expect(visible.nodes.map((node) => node.id)).toEqual(['file', 'action', 'query']);
    expect(visible.edges.map((edge) => edge.id)).toEqual(['e1', 'e2']);

    const searchFiltered = applySearchFilter(visible, 'todo');
    expect(searchFiltered.nodes.map((node) => node.id)).toEqual(['file', 'action', 'query']);
    expect(applySearchFilter(visible, 'missing').nodes).toEqual([]);
  });

  it('narrows by file query while preserving query-key context', () => {
    const visible = computeVisibleGraph(
      createGraph({
        nodes: [
          createGraphNode({ id: 'file-a', kind: 'file', label: 'src/a.ts', resolution: 'static' }),
          createGraphNode({ id: 'file-b', kind: 'file', label: 'src/b.ts', resolution: 'static' }),
          createGraphNode({
            id: 'action-a',
            kind: 'action',
            label: 'invalidate',
            file: 'src/a.ts',
            resolution: 'static',
            metrics: { relation: 'invalidates', displayFile: 'src/a.ts' },
          }),
          createGraphNode({
            id: 'action-b',
            kind: 'action',
            label: 'set',
            file: 'src/b.ts',
            resolution: 'static',
            metrics: { relation: 'sets', displayFile: 'src/b.ts' },
          }),
          createGraphNode({
            id: 'action-unknown',
            kind: 'action',
            label: 'unknown',
            file: 'src/unknown.ts',
            resolution: 'static',
            metrics: { relation: 'declares' },
          }),
          createGraphNode({ id: 'query-a', kind: 'queryKey', label: 'a', resolution: 'static' }),
          createGraphNode({ id: 'query-b', kind: 'queryKey', label: 'b', resolution: 'static' }),
        ],
        edges: [
          createGraphEdge({ id: 'fa', source: 'file-a', target: 'action-a', relation: 'invalidates' }),
          createGraphEdge({ id: 'aq', source: 'action-a', target: 'query-a', relation: 'invalidates' }),
          createGraphEdge({ id: 'ignored-shape', source: 'query-a', target: 'file-a', relation: 'invalidates' }),
          createGraphEdge({ id: 'fb', source: 'file-b', target: 'action-b', relation: 'sets' }),
          createGraphEdge({ id: 'bq', source: 'action-b', target: 'query-b', relation: 'sets' }),
          createGraphEdge({ id: 'missing', source: 'missing-file', target: 'action-a', relation: 'invalidates' }),
        ],
      }),
      {
        relation: {
          invalidates: true,
          sets: true,
          refetches: false,
          cancels: false,
          resets: false,
          removes: false,
          clears: false,
        },
        fileQuery: 'src/b',
        search: '',
      },
    );

    expect(visible.nodes.map((node) => node.id)).toEqual(['file-b', 'action-b', 'query-a', 'query-b']);
    expect(visible.edges.map((edge) => edge.id)).toEqual(['fb', 'bq']);
    expect(visible.summary).toMatchObject({ files: 1, actions: 1, queryKeys: 2 });
  });

  it('returns the original graph for blank search and expands around matches', () => {
    expect(applySearchFilter(graph, '   ')).toBe(graph);

    const visible = applySearchFilter(graph, 'invalidate');
    expect(visible.nodes.map((node) => node.id)).toEqual(['file', 'action', 'query', 'other-action']);
    expect(visible.edges.map((edge) => edge.id)).toEqual(['e1', 'e2', 'e3']);

    const isolated = createGraph({
      nodes: [createGraphNode({ id: 'lonely', kind: 'file', label: 'lonely.ts', resolution: 'static' })],
      edges: [],
    });
    expect(applySearchFilter(isolated, 'lonely').nodes.map((node) => node.id)).toEqual(['lonely']);
  });
});
