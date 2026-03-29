import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNodeExplanation, collapseGraphIfLarge } from '../src/webview/graphUtils';
import type { GraphData } from '../src/webview/model';

test('collapsed grouped query nodes keep a real label', () => {
  const graph: GraphData = {
    nodes: [
      {
        id: 'action:declare',
        kind: 'action',
        label: 'useQuery',
        file: '/repo/packages/app/query.ts',
        loc: { line: 10, column: 5 },
        resolution: 'static',
        metrics: {
          relation: 'declares',
          declaresDirectly: 1,
          displayFile: 'packages/app/query.ts',
          projectScope: 'repo:packages/app',
        },
      },
      {
        id: 'action:invalidate',
        kind: 'action',
        label: 'invalidateQueries',
        file: '/repo/packages/app/query.ts',
        loc: { line: 20, column: 3 },
        resolution: 'dynamic',
        metrics: { relation: 'invalidates', displayFile: 'packages/app/query.ts', projectScope: 'repo:packages/app' },
      },
      {
        id: 'qk:one',
        kind: 'queryKey',
        label: '[movies, list]',
        resolution: 'static',
        metrics: { rootSegment: 'movies', projectScope: 'repo:packages/app', declaredCallsites: 1 },
      },
      {
        id: 'qk:two',
        kind: 'queryKey',
        label: '[movies, detail]',
        resolution: 'static',
        metrics: { rootSegment: 'movies', projectScope: 'repo:packages/app', declaredCallsites: 1 },
      },
    ],
    edges: [
      { id: 'e1', source: 'action:declare', target: 'qk:one', relation: 'declares', resolution: 'static' },
      { id: 'e2', source: 'action:invalidate', target: 'qk:one', relation: 'invalidates', resolution: 'dynamic' },
      { id: 'e3', source: 'action:invalidate', target: 'qk:two', relation: 'invalidates', resolution: 'dynamic' },
    ],
    summary: { files: 0, actions: 2, queryKeys: 2, parseErrors: 0 },
    parseErrors: [],
  };

  const collapsed = collapseGraphIfLarge(graph, 1).graph;
  const groupedQuery = collapsed.nodes.find((node) => node.kind === 'queryKey');
  assert.ok(groupedQuery);
  assert.equal(groupedQuery.label, '[movies, detail]');

  const explanation = buildNodeExplanation(collapsed, groupedQuery, graph);
  assert.ok(explanation);
  assert.equal(explanation.queryKeys[0], groupedQuery.label);
});
