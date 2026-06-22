import { describe, expect, it } from 'vitest';

import { buildNodeExplanation } from '../nodeExplanation';
import { createGraph, createGraphEdge, createGraphNode } from '../../../testing/fixtures';

describe('webview/utils/nodeExplanation', () => {
  it('builds file, action, and query explanations', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'src/file.ts',
          file: '/workspace/src/file.ts',
          resolution: 'static',
          metrics: { affectedKeys: 2 },
        }),
        createGraphNode({
          id: 'action-invalidate',
          kind: 'action',
          label: 'invalidateTodos',
          file: '/workspace/src/file.ts',
          resolution: 'static',
          loc: { line: 10, column: 2 },
          metrics: { relation: 'invalidates', displayFile: 'src/file.ts' },
        }),
        createGraphNode({
          id: 'action-set',
          kind: 'action',
          label: 'setTodos',
          file: '/workspace/src/file.ts',
          resolution: 'static',
          loc: { line: 20, column: 4 },
          metrics: { relation: 'sets', displayFile: 'src/file.ts' },
        }),
        createGraphNode({
          id: 'query-a',
          kind: 'queryKey',
          label: 'todo',
          resolution: 'static',
          metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', representativeQueryNodeId: 'representative' },
        }),
        createGraphNode({
          id: 'query-b',
          kind: 'queryKey',
          label: 'todo item',
          resolution: 'static',
          metrics: { rootSegment: 'todo', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-placeholder',
          kind: 'queryKey',
          label: '[$todo]',
          resolution: 'static',
          metrics: { rootSegment: 'todo', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-alpha',
          kind: 'queryKey',
          label: 'alpha',
          resolution: 'static',
          metrics: { rootSegment: 'alpha', projectScope: 'web:apps/web' },
        }),
      ],
      edges: [
        createGraphEdge({
          id: 'file-action-invalidate',
          source: 'file',
          target: 'action-invalidate',
          relation: 'invalidates',
        }),
        createGraphEdge({ id: 'file-action-set', source: 'file', target: 'action-set', relation: 'sets' }),
        createGraphEdge({
          id: 'action-invalidate-query-a',
          source: 'action-invalidate',
          target: 'query-a',
          relation: 'invalidates',
        }),
        createGraphEdge({
          id: 'action-invalidate-query-b',
          source: 'action-invalidate',
          target: 'query-b',
          relation: 'invalidates',
        }),
        createGraphEdge({
          id: 'action-invalidate-placeholder',
          source: 'action-invalidate',
          target: 'query-placeholder',
          relation: 'invalidates',
        }),
        createGraphEdge({ id: 'action-set-query-a', source: 'action-set', target: 'query-a', relation: 'sets' }),
        createGraphEdge({
          id: 'action-set-query-alpha',
          source: 'action-set',
          target: 'query-alpha',
          relation: 'sets',
        }),
      ],
    });

    const declarationGraph = createGraph({
      nodes: [
        createGraphNode({
          id: 'declares-a',
          kind: 'action',
          label: 'useTodo',
          file: '/workspace/src/todo.ts',
          resolution: 'static',
          loc: { line: 3, column: 5 },
          metrics: { relation: 'declares', declaresDirectly: 1, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'declares-b',
          kind: 'action',
          label: 'useTodoLater',
          file: '/workspace/src/todo.ts',
          resolution: 'static',
          loc: { line: 1, column: 7 },
          metrics: { relation: 'declares', declaresDirectly: 1, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'representative',
          kind: 'queryKey',
          label: 'todo',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'declare-a', source: 'declares-a', target: 'representative', relation: 'declares' }),
        createGraphEdge({ id: 'declare-b', source: 'declares-b', target: 'representative', relation: 'declares' }),
      ],
    });

    const fileNode = graph.nodes[0];
    const actionInvalidateNode = graph.nodes[1];
    const queryNode = graph.nodes[3];
    if (!fileNode || !actionInvalidateNode || !queryNode) {
      throw new Error('Missing explanation nodes');
    }

    const fileExplanation = buildNodeExplanation(graph, fileNode);
    expect(fileExplanation?.summary).toContain('contains 2 callsites');
    expect(fileExplanation?.files).toEqual([
      { label: 'src/file.ts', file: '/workspace/src/file.ts', line: undefined, column: undefined },
    ]);
    expect(fileExplanation?.actions.map((entry) => entry.label)).toEqual([
      'invalidateTodos in src/file.ts @ 10:2',
      'setTodos in src/file.ts @ 20:4',
    ]);
    expect(fileExplanation?.queryKeys).toEqual(['alpha', 'todo']);

    const actionExplanation = buildNodeExplanation(graph, actionInvalidateNode);
    expect(actionExplanation?.summary).toContain('invalidates call from src/file.ts @ 10:2');
    expect(actionExplanation?.files[0]).toMatchObject({
      label: 'src/file.ts',
      file: 'src/file.ts',
    });
    expect(actionExplanation?.queryKeys).toEqual(['todo']);

    const queryExplanation = buildNodeExplanation(graph, queryNode, declarationGraph);
    expect(queryExplanation?.summary).toContain('is referenced by 2 callsites in 1 files');
    expect(queryExplanation?.declarations.map((entry) => entry.label)).toEqual([
      'useTodoLater in /workspace/src/todo.ts @ 1:7',
      'useTodo in /workspace/src/todo.ts @ 3:5',
    ]);
    expect(queryExplanation?.files.map((entry) => entry.label)).toEqual(['src/file.ts']);
    expect(queryExplanation?.queryKeys).toEqual(['todo']);

    expect(buildNodeExplanation(graph, null)).toBeNull();
  });

  it('handles empty relationships and fallback declarations', () => {
    const queryOnlyGraph = createGraph({
      nodes: [
        createGraphNode({
          id: 'query-only',
          kind: 'queryKey',
          label: 'lonely',
          resolution: 'static',
          metrics: { rootSegment: 'lonely', projectScope: 'workspace:*' },
        }),
        createGraphNode({
          id: 'file-only',
          kind: 'file',
          label: 'src/file.ts',
          resolution: 'static',
        }),
        createGraphNode({
          id: 'action-only',
          kind: 'action',
          label: 'refetch',
          file: 'src/file.ts',
          resolution: 'static',
          metrics: { relation: 'refetches' },
        }),
      ],
      edges: [],
    });

    const queryExplanation = buildNodeExplanation(
      queryOnlyGraph,
      queryOnlyGraph.nodes[0] ?? null,
      createGraph({ nodes: [], edges: [] }),
    );
    expect(queryExplanation?.summary).toContain('0 callsites in 0 files');
    expect(queryExplanation?.declarations).toEqual([]);
    expect(queryExplanation?.queryKeys).toEqual(['lonely']);

    const fileExplanation = buildNodeExplanation(queryOnlyGraph, queryOnlyGraph.nodes[1] ?? null);
    expect(fileExplanation?.summary).toContain('contains 0 callsites (none)');
    expect(fileExplanation?.actions).toEqual([]);
    expect(fileExplanation?.queryKeys).toEqual([]);

    const actionExplanation = buildNodeExplanation(queryOnlyGraph, queryOnlyGraph.nodes[2] ?? null);
    expect(actionExplanation?.summary).toContain('refetches call from src/file.ts @ -');
    expect(actionExplanation?.files).toEqual([
      { label: 'src/file.ts', file: 'src/file.ts', line: undefined, column: undefined },
    ]);
  });

  it('dedupes declaration callsites and keeps the shortest related query label', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'query',
          kind: 'queryKey',
          label: 'root',
          resolution: 'static',
          metrics: { rootSegment: 'root', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'action',
          kind: 'action',
          label: 'invalidateRoot',
          file: 'src/root.ts',
          resolution: 'static',
          loc: { line: 2, column: 1 },
          metrics: { relation: 'invalidates', displayFile: 'src/root.ts' },
        }),
        createGraphNode({
          id: 'action-file',
          kind: 'file',
          label: 'src/root.ts',
          resolution: 'static',
        }),
        createGraphNode({
          id: 'query-short',
          kind: 'queryKey',
          label: 'r',
          resolution: 'static',
          metrics: { rootSegment: 'root', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-short-s',
          kind: 'queryKey',
          label: 's',
          resolution: 'static',
          metrics: { rootSegment: 'root', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-long',
          kind: 'queryKey',
          label: 'root-long',
          resolution: 'static',
          metrics: { rootSegment: 'root', projectScope: 'web:apps/web' },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'action-query', source: 'action', target: 'query', relation: 'invalidates' }),
        createGraphEdge({ id: 'action-query-short', source: 'action', target: 'query-short', relation: 'invalidates' }),
        createGraphEdge({
          id: 'action-query-short-s',
          source: 'action',
          target: 'query-short-s',
          relation: 'invalidates',
        }),
        createGraphEdge({ id: 'action-query-long', source: 'action', target: 'query-long', relation: 'invalidates' }),
        createGraphEdge({ id: 'file-action', source: 'action-file', target: 'action', relation: 'invalidates' }),
      ],
    });

    const declarationGraph = createGraph({
      nodes: [
        createGraphNode({
          id: 'declares-a',
          kind: 'action',
          label: 'useRoot',
          file: '/workspace/src/root.ts',
          resolution: 'static',
          loc: { line: 9, column: 2 },
          metrics: { relation: 'declares', declaresDirectly: 1, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'declares-b',
          kind: 'action',
          label: 'useRoot',
          file: '/workspace/src/root.ts',
          resolution: 'static',
          loc: { line: 9, column: 2 },
          metrics: { relation: 'declares', declaresDirectly: 1, projectScope: 'web:apps/web' },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'declare-a', source: 'declares-a', target: 'query', relation: 'declares' }),
        createGraphEdge({ id: 'declare-b', source: 'declares-b', target: 'query', relation: 'declares' }),
      ],
    });

    const explanation = buildNodeExplanation(graph, graph.nodes[0] ?? null, declarationGraph);
    expect(explanation?.queryKeys).toEqual(['root']);
    expect(explanation?.declarations).toHaveLength(1);
    expect(explanation?.actions[0]?.label).toBe('invalidateRoot in src/root.ts @ 2:1');
  });

  it('uses displayFile metric as file fallback when action.file is undefined', () => {
    // An action node with no `file` property but with `metrics.displayFile` set,
    // that has no parent file node in the graph.  This exercises the
    // `actionNode.file ?? fallbackPath` branch inside buildExplanationForQuery (line 216).
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'action-display-only',
          kind: 'action',
          label: 'displayOnlyAction',
          resolution: 'static',
          metrics: { relation: 'invalidates', displayFile: 'src/display.ts' },
          // intentionally no `file` property
        }),
        createGraphNode({
          id: 'query-display',
          kind: 'queryKey',
          label: 'displayQuery',
          resolution: 'static',
        }),
      ],
      edges: [
        createGraphEdge({
          id: 'action-display-only-query',
          source: 'action-display-only',
          target: 'query-display',
          relation: 'invalidates',
        }),
      ],
    });

    const queryNode = graph.nodes.find((n) => n.id === 'query-display') ?? null;
    const explanation = buildNodeExplanation(graph, queryNode);
    // The fallbackPath comes from nodeFileDisplay → metrics.displayFile.
    // actionNode.file is undefined so fileRef uses fallbackPath as both label and file.
    expect(explanation?.files).toEqual([
      { label: 'src/display.ts', file: 'src/display.ts', line: undefined, column: undefined },
    ]);
  });

  it('sorts fallback locations and records query files from action metadata', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'src/current.ts',
          resolution: 'static',
        }),
        createGraphNode({
          id: 'action-b',
          kind: 'action',
          label: 'zAction',
          file: 'src/b.ts',
          resolution: 'static',
          loc: { line: 3, column: 2 },
          metrics: { relation: 'invalidates' },
        }),
        createGraphNode({
          id: 'action-a',
          kind: 'action',
          label: 'aAction',
          file: 'src/a.ts',
          resolution: 'static',
          loc: { line: 3, column: 1 },
          metrics: { relation: 'invalidates' },
        }),
        createGraphNode({
          id: 'action-a-later',
          kind: 'action',
          label: 'laterAction',
          file: 'src/a.ts',
          resolution: 'static',
          loc: { line: 4, column: 1 },
          metrics: { relation: 'sets' },
        }),
        createGraphNode({
          id: 'action-orphan',
          kind: 'action',
          label: 'orphanAction',
          file: 'src/orphan.ts',
          resolution: 'static',
          loc: { line: 8, column: 1 },
          metrics: { relation: 'invalidates' },
        }),
        createGraphNode({
          id: 'query-line',
          kind: 'queryKey',
          label: 'aa',
          resolution: 'static',
          loc: { line: 2, column: 8 },
          metrics: { rootSegment: 'same', projectScope: 'web' },
        }),
        createGraphNode({
          id: 'query-column',
          kind: 'queryKey',
          label: 'ab',
          resolution: 'static',
          loc: { line: 2, column: 1 },
          metrics: { rootSegment: 'same', projectScope: 'web' },
        }),
        createGraphNode({
          id: 'query-orphan',
          kind: 'queryKey',
          label: 'orphan',
          resolution: 'static',
          metrics: { rootSegment: 'orphan', projectScope: 'web' },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'file-action-b', source: 'file', target: 'action-b', relation: 'invalidates' }),
        createGraphEdge({ id: 'file-action-a', source: 'file', target: 'action-a', relation: 'invalidates' }),
        createGraphEdge({ id: 'file-action-later', source: 'file', target: 'action-a-later', relation: 'sets' }),
        createGraphEdge({
          id: 'action-b-query-line',
          source: 'action-b',
          target: 'query-line',
          relation: 'invalidates',
        }),
        createGraphEdge({
          id: 'action-a-query-column',
          source: 'action-a',
          target: 'query-column',
          relation: 'invalidates',
        }),
        createGraphEdge({
          id: 'action-orphan-query',
          source: 'action-orphan',
          target: 'query-orphan',
          relation: 'invalidates',
        }),
      ],
    });

    const fileExplanation = buildNodeExplanation(graph, graph.nodes[0] ?? null);
    expect(fileExplanation?.actions.map((entry) => entry.label)).toEqual([
      'aAction in src/a.ts @ 3:1',
      'laterAction in src/a.ts @ 4:1',
      'zAction in src/b.ts @ 3:2',
    ]);
    expect(fileExplanation?.queryKeys).toEqual(['ab']);

    const queryExplanation = buildNodeExplanation(graph, graph.nodes[7] ?? null);
    expect(queryExplanation?.files).toEqual([
      { label: 'src/orphan.ts', file: 'src/orphan.ts', line: undefined, column: undefined },
    ]);
  });

  it('handles missing metadata while sorting actions, queries, and declarations', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'src/file.ts',
          resolution: 'static',
        }),
        createGraphNode({
          id: 'action-no-file',
          kind: 'action',
          label: 'noFileAction',
          resolution: 'static',
        }),
        createGraphNode({
          id: 'action-no-file-b',
          kind: 'action',
          label: 'anotherNoFileAction',
          resolution: 'static',
        }),
        createGraphNode({
          id: 'action-same-line-a',
          kind: 'action',
          label: 'sameLineA',
          file: 'src/same.ts',
          resolution: 'static',
          loc: { line: 5, column: 3 },
        }),
        createGraphNode({
          id: 'action-same-line-b',
          kind: 'action',
          label: 'sameLineB',
          file: 'src/same.ts',
          resolution: 'static',
          loc: { line: 5, column: 1 },
        }),
        createGraphNode({
          id: 'action-same-location-a',
          kind: 'action',
          label: 'alphaSameLocation',
          file: 'src/same.ts',
          resolution: 'static',
          loc: { line: 6, column: 1 },
        }),
        createGraphNode({
          id: 'action-same-location-b',
          kind: 'action',
          label: 'betaSameLocation',
          file: 'src/same.ts',
          resolution: 'static',
          loc: { line: 6, column: 1 },
        }),
        createGraphNode({
          id: 'query-no-metrics',
          kind: 'queryKey',
          label: 'no metrics',
          resolution: 'static',
        }),
        createGraphNode({
          id: 'query-line-first',
          kind: 'queryKey',
          label: 'aa',
          resolution: 'static',
          loc: { line: 1, column: 9 },
          metrics: { rootSegment: 'same', projectScope: 'web' },
        }),
        createGraphNode({
          id: 'query-line-second',
          kind: 'queryKey',
          label: 'ab',
          resolution: 'static',
          loc: { line: 2, column: 1 },
          metrics: { rootSegment: 'same', projectScope: 'web' },
        }),
        createGraphNode({
          id: 'action-orphan-no-file',
          kind: 'action',
          label: 'orphanNoFileAction',
          resolution: 'static',
        }),
        createGraphNode({
          id: 'query-orphan-no-file',
          kind: 'queryKey',
          label: 'orphan no file',
          resolution: 'static',
        }),
      ],
      edges: [
        createGraphEdge({
          id: 'file-action-no-file',
          source: 'file',
          target: 'action-no-file',
          relation: 'invalidates',
        }),
        createGraphEdge({
          id: 'file-action-no-file-b',
          source: 'file',
          target: 'action-no-file-b',
          relation: 'invalidates',
        }),
        createGraphEdge({ id: 'file-action-a', source: 'file', target: 'action-same-line-a', relation: 'invalidates' }),
        createGraphEdge({ id: 'file-action-b', source: 'file', target: 'action-same-line-b', relation: 'invalidates' }),
        createGraphEdge({
          id: 'file-action-same-location-a',
          source: 'file',
          target: 'action-same-location-a',
          relation: 'invalidates',
        }),
        createGraphEdge({
          id: 'file-action-same-location-b',
          source: 'file',
          target: 'action-same-location-b',
          relation: 'invalidates',
        }),
        createGraphEdge({
          id: 'action-no-file-query',
          source: 'action-no-file',
          target: 'query-no-metrics',
          relation: 'invalidates',
        }),
        createGraphEdge({
          id: 'action-a-query-line-first',
          source: 'action-same-line-a',
          target: 'query-line-first',
          relation: 'invalidates',
        }),
        createGraphEdge({
          id: 'action-b-query-line-second',
          source: 'action-same-line-b',
          target: 'query-line-second',
          relation: 'invalidates',
        }),
        createGraphEdge({
          id: 'action-same-location-a-file',
          source: 'action-same-location-a',
          target: 'file',
          relation: 'invalidates',
        }),
        createGraphEdge({
          id: 'action-orphan-no-file-query',
          source: 'action-orphan-no-file',
          target: 'query-orphan-no-file',
          relation: 'invalidates',
        }),
      ],
    });
    const declarationGraph = createGraph({
      nodes: [
        createGraphNode({
          id: 'declare-no-location',
          kind: 'action',
          label: 'declareNoLocation',
          resolution: 'static',
          metrics: { relation: 'declares', declaresDirectly: 1 },
        }),
      ],
      edges: [
        createGraphEdge({
          id: 'declare-no-location-query',
          source: 'declare-no-location',
          target: 'query-no-metrics',
          relation: 'declares',
        }),
      ],
    });

    const fileNode = graph.nodes.find((node) => node.id === 'file') ?? null;
    const actionNoFile = graph.nodes.find((node) => node.id === 'action-no-file') ?? null;
    const actionOrphanNoFile = graph.nodes.find((node) => node.id === 'action-orphan-no-file') ?? null;
    const queryNoMetrics = graph.nodes.find((node) => node.id === 'query-no-metrics') ?? null;
    const queryOrphanNoFile = graph.nodes.find((node) => node.id === 'query-orphan-no-file') ?? null;

    const fileExplanation = buildNodeExplanation(graph, fileNode);
    expect(fileExplanation?.summary).toContain('unknown:6');
    expect(fileExplanation?.actions.map((entry) => entry.label)).toEqual([
      'anotherNoFileAction in  @ -',
      'noFileAction in  @ -',
      'sameLineB in src/same.ts @ 5:1',
      'sameLineA in src/same.ts @ 5:3',
      'alphaSameLocation in src/same.ts @ 6:1',
      'betaSameLocation in src/same.ts @ 6:1',
    ]);
    expect(fileExplanation?.queryKeys).toEqual(['aa', 'no metrics']);

    const actionExplanation = buildNodeExplanation(graph, actionNoFile);
    expect(actionExplanation?.summary).toContain('action call from src/file.ts @ -');

    const orphanActionExplanation = buildNodeExplanation(graph, actionOrphanNoFile);
    expect(orphanActionExplanation?.files).toEqual([]);

    const queryExplanation = buildNodeExplanation(graph, queryNoMetrics, declarationGraph);
    expect(queryExplanation?.files).toEqual([
      { label: 'src/file.ts', file: 'src/file.ts', line: undefined, column: undefined },
    ]);
    expect(queryExplanation?.declarations).toEqual([
      {
        label: 'declareNoLocation in  @ -',
        file: undefined,
        line: undefined,
        column: undefined,
        relation: undefined,
      },
    ]);

    const orphanQueryExplanation = buildNodeExplanation(graph, queryOrphanNoFile);
    expect(orphanQueryExplanation?.files).toEqual([]);
  });
});
