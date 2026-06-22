import { describe, expect, it } from 'vitest';

import { SHARED_SOURCE_HANDLE_ID, SHARED_TARGET_HANDLE_ID } from '../constants';
import { buildFlowGraph } from '../flowGraph';
import { createGraph, createGraphEdge, createGraphNode } from '../../../testing/fixtures';

describe('webview/utils/flowGraph', () => {
  const graph = createGraph({
    nodes: [
      createGraphNode({
        id: 'file',
        kind: 'file',
        label: 'src/file.ts',
        file: '/workspace/src/file.ts',
        resolution: 'static',
        metrics: { affectedKeys: 2, projectScope: 'web:apps/web' },
      }),
      createGraphNode({
        id: 'action-a',
        kind: 'action',
        label: 'invalidateTodos',
        file: '/workspace/src/file.ts',
        resolution: 'static',
        loc: { line: 10, column: 2 },
        metrics: { relation: 'invalidates', displayFile: 'src/file.ts', projectScope: 'web:apps/web' },
      }),
      createGraphNode({
        id: 'action-b',
        kind: 'action',
        label: 'setTodos',
        file: '/workspace/src/file.ts',
        resolution: 'static',
        loc: { line: 20, column: 4 },
        metrics: { relation: 'sets', displayFile: 'src/file.ts', projectScope: 'web:apps/web' },
      }),
      createGraphNode({
        id: 'query',
        kind: 'queryKey',
        label: 'todo',
        resolution: 'static',
        metrics: {
          rootSegment: 'todo',
          projectScope: 'web:apps/web',
          affectedFiles: 2,
          declaredFiles: 1,
          declaredCallsites: 1,
          grouped: 3,
        },
      }),
      createGraphNode({
        id: 'query-extra',
        kind: 'queryKey',
        label: 'todo extra',
        resolution: 'static',
        metrics: { rootSegment: 'todo', projectScope: 'web:apps/web' },
      }),
    ],
    edges: [
      createGraphEdge({ id: 'file-action-a', source: 'file', target: 'action-a', relation: 'invalidates' }),
      createGraphEdge({ id: 'file-action-b', source: 'file', target: 'action-b', relation: 'sets' }),
      createGraphEdge({ id: 'action-a-query', source: 'action-a', target: 'query', relation: 'invalidates' }),
      createGraphEdge({
        id: 'action-a-query-extra',
        source: 'action-a',
        target: 'query-extra',
        relation: 'invalidates',
      }),
      createGraphEdge({ id: 'action-b-query', source: 'action-b', target: 'query', relation: 'sets' }),
    ],
  });

  it('builds highlighted graph nodes and relation lanes', () => {
    const flow = buildFlowGraph(graph, '', {
      highlightedNodeIds: new Set(['action-a']),
      highlightedEdgeIds: new Set(['action-a-query']),
      selectedNodeId: 'query',
    });

    const nodeById = new Map(flow.nodes.map((node) => [node.id, node]));
    const edgeById = new Map(flow.edges.map((edge) => [edge.id, edge]));

    expect(nodeById.get('file')?.data).toMatchObject({
      title: 'src/file.ts',
      subtitle: 'File node · 2 linked query keys',
      dim: true,
      highlighted: false,
      selected: false,
    });
    expect(nodeById.get('action-a')?.data).toMatchObject({
      title: 'invalidateTodos',
      subtitle: 'Called in src/file.ts @ 10:2',
      relation: 'invalidates',
      dim: false,
      highlighted: true,
      selected: false,
    });
    expect(nodeById.get('query')?.data).toMatchObject({
      subtitle: 'QueryKey node · 2 callsites in 1 file · defined in 1 callsite (1 file) | grouped 3',
      dim: false,
      highlighted: false,
      selected: true,
    });
    expect(nodeById.get('query')?.style).toMatchObject({
      opacity: 1,
      zIndex: 20,
    });
    expect(edgeById.get('action-a-query')?.data).toMatchObject({
      relation: 'invalidates',
      dim: false,
      highlighted: true,
    });
    expect(edgeById.get('action-a-query')?.sourceHandle).toBe(SHARED_SOURCE_HANDLE_ID);
    expect(edgeById.get('action-a-query')?.targetHandle).toBe(SHARED_TARGET_HANDLE_ID);
    expect(edgeById.get('action-b-query')?.data).toMatchObject({
      relation: 'sets',
      dim: true,
      highlighted: false,
    });
  });

  it('dims nodes when search text does not match', () => {
    const flow = buildFlowGraph(graph, 'missing');
    expect(flow.nodes.every((node) => node.style?.opacity === 0.34)).toBe(true);
    expect(flow.edges.every((edge) => edge.data?.dim === true)).toBe(true);
  });

  it('falls back cleanly with no selected node and empty graph data', () => {
    const flow = buildFlowGraph(createGraph({ nodes: [], edges: [] }), '', {
      highlightedNodeIds: new Set(),
      highlightedEdgeIds: new Set(),
      selectedNodeId: null,
    });

    expect(flow.nodes).toEqual([]);
    expect(flow.edges).toEqual([]);
  });

  it('keeps dangling edges and unknown relations stable', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'source',
          kind: 'action',
          label: 'source',
          resolution: 'static',
          metrics: { relation: 'custom', projectScope: 'web:apps/web' },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'dangling', source: 'missing', target: 'missing', relation: 'custom' as never }),
        createGraphEdge({ id: 'custom', source: 'source', target: 'missing', relation: 'custom' as never }),
      ],
    });

    const flow = buildFlowGraph(graph, '', {
      highlightedNodeIds: new Set(),
      highlightedEdgeIds: new Set(),
      selectedNodeId: null,
    });

    expect(flow.edges.some((edge) => edge.id === 'dangling')).toBe(true);
    expect(flow.edges.some((edge) => edge.id === 'custom')).toBe(true);
  });

  it('uses singular form for file node with exactly one linked query key', () => {
    const singleKeyGraph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-single',
          kind: 'file',
          label: 'src/single.ts',
          resolution: 'static',
          metrics: { affectedKeys: 1 },
        }),
        createGraphNode({
          id: 'isolated-query',
          kind: 'queryKey',
          label: 'alone',
          resolution: 'static',
        }),
      ],
      edges: [],
    });

    const flow = buildFlowGraph(singleKeyGraph, '');
    const nodeById = new Map(flow.nodes.map((n) => [n.id, n]));

    // Singular 'key' instead of 'keys'.
    expect(nodeById.get('file-single')?.data).toMatchObject({
      subtitle: 'File node · 1 linked query key',
    });

    // Isolated query node has no incoming action edges, so action and file counts are 0.
    expect(nodeById.get('isolated-query')?.data).toMatchObject({
      subtitle: 'QueryKey node · 0 callsites in 0 files',
    });
  });

  it('assigns lane bands for all relations and falls back to action file labels', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'plain-file',
          kind: 'file',
          label: 'plain.ts',
          resolution: 'static',
        }),
        createGraphNode({
          id: 'plain-action',
          kind: 'action',
          label: 'plainAction',
          file: 'src/plain.ts',
          resolution: 'static',
        }),
        createGraphNode({
          id: 'action',
          kind: 'action',
          label: 'run',
          file: '/workspace/src/action.ts',
          resolution: 'static',
          metrics: { relation: 'removes' },
        }),
        createGraphNode({
          id: 'query-a',
          kind: 'queryKey',
          label: 'a',
          resolution: 'static',
        }),
        createGraphNode({
          id: 'query-b',
          kind: 'queryKey',
          label: 'b',
          resolution: 'static',
          metrics: { declaredFiles: 2, declaredCallsites: 2 },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'file-query-skip', source: 'plain-file', target: 'query-a', relation: 'declares' }),
        createGraphEdge({
          id: 'plain-action-query',
          source: 'plain-action',
          target: 'query-a',
          relation: 'invalidates',
        }),
        createGraphEdge({ id: 'declares-a', source: 'action', target: 'query-a', relation: 'declares' }),
        createGraphEdge({ id: 'removes-a', source: 'action', target: 'query-a', relation: 'removes' }),
        createGraphEdge({ id: 'resets-a', source: 'action', target: 'query-a', relation: 'resets' }),
        createGraphEdge({ id: 'clears-a', source: 'action', target: 'query-a', relation: 'clears' }),
        createGraphEdge({ id: 'cancels-a', source: 'action', target: 'query-a', relation: 'cancels' }),
        createGraphEdge({ id: 'refetches-a', source: 'action', target: 'query-a', relation: 'refetches' }),
        createGraphEdge({ id: 'same-target-1', source: 'action', target: 'query-b', relation: 'removes' }),
        createGraphEdge({ id: 'same-target-2', source: 'action', target: 'query-b', relation: 'removes' }),
      ],
    });

    const flow = buildFlowGraph(graph, 'query');
    const nodeById = new Map(flow.nodes.map((node) => [node.id, node]));
    const edgeById = new Map(flow.edges.map((edge) => [edge.id, edge]));

    expect(nodeById.get('action')?.data).toMatchObject({
      subtitle: 'Called in /workspace/src/action.ts @ -',
    });
    expect(nodeById.get('plain-file')?.data).toMatchObject({
      subtitle: 'File node · 0 linked query keys',
    });
    expect(nodeById.get('plain-action')?.data).toMatchObject({
      subtitle: 'Called in src/plain.ts @ -',
      relation: undefined,
    });
    expect(nodeById.get('query-b')?.data?.subtitle).toContain('defined in 2 callsites (2 files)');
    expect(edgeById.get('declares-a')?.data?.laneOffset).toBeLessThan(0);
    expect(edgeById.get('removes-a')?.data?.laneOffset).toBeGreaterThan(0);
    expect(edgeById.get('resets-a')?.data?.laneOffset).toBeGreaterThan(0);
    expect(edgeById.get('clears-a')?.data?.laneOffset).toBeGreaterThan(0);
    expect(edgeById.get('cancels-a')?.data?.laneOffset).toBeLessThan(0);
    expect(edgeById.get('refetches-a')?.data?.laneOffset).toBeLessThan(0);
    expect(edgeById.get('same-target-1')?.data?.laneOffset).not.toBe(edgeById.get('same-target-2')?.data?.laneOffset);
  });
});
