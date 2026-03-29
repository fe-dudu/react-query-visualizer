import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNodeExplanation } from '../src/webview/graphUtils';
import type { GraphData } from '../src/webview/model';

test('action explanation hides placeholder-only related query keys when a specific key exists', () => {
  const graph: GraphData = {
    nodes: [
      {
        id: 'file:a',
        kind: 'file',
        label: 'packages/preact-query/src/__tests__/useQuery.test.tsx',
        resolution: 'static',
      },
      {
        id: 'action:a',
        kind: 'action',
        label: 'invalidateQueries',
        file: '/repo/packages/preact-query/src/__tests__/useQuery.test.tsx',
        loc: { line: 1052, column: 28 },
        resolution: 'dynamic',
        metrics: { relation: 'invalidates', displayFile: 'packages/preact-query/src/__tests__/useQuery.test.tsx' },
      },
      { id: 'qk:specific', kind: 'queryKey', label: '[query_${' + 'queryKeyCount}]', resolution: 'dynamic' },
      { id: 'qk:key', kind: 'queryKey', label: '$key', resolution: 'dynamic' },
      { id: 'qk:options', kind: 'queryKey', label: '$options', resolution: 'dynamic' },
      { id: 'qk:array', kind: 'queryKey', label: '[$key, $page]', resolution: 'dynamic' },
    ],
    edges: [
      { id: 'e1', source: 'file:a', target: 'action:a', relation: 'invalidates', resolution: 'dynamic' },
      { id: 'e2', source: 'action:a', target: 'qk:specific', relation: 'invalidates', resolution: 'dynamic' },
      { id: 'e3', source: 'action:a', target: 'qk:key', relation: 'invalidates', resolution: 'dynamic' },
      { id: 'e4', source: 'action:a', target: 'qk:options', relation: 'invalidates', resolution: 'dynamic' },
      { id: 'e5', source: 'action:a', target: 'qk:array', relation: 'invalidates', resolution: 'dynamic' },
    ],
    summary: { files: 1, actions: 1, queryKeys: 4, parseErrors: 0 },
    parseErrors: [],
  };

  const selectedNode = graph.nodes.find((node) => node.id === 'action:a') ?? null;
  const explanation = buildNodeExplanation(graph, selectedNode);

  assert.ok(explanation);
  assert.deepEqual(explanation.queryKeys, ['[query_${' + 'queryKeyCount}]']);
});
