import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGraph } from '../src/core/graphBuilder';
import type { AnalysisResult, QueryRecord } from '../src/types';

const roots = [{ name: 'repo', path: '/repo' }];

function makeRecord(input: {
  relation: QueryRecord['relation'];
  operation: string;
  file: string;
  queryKeyId: string;
  display: string;
  source: QueryRecord['queryKey']['source'];
  resolution?: QueryRecord['queryKey']['resolution'];
}): QueryRecord {
  return {
    relation: input.relation,
    operation: input.operation,
    file: input.file,
    loc: { line: 1, column: 1 },
    resolution: input.resolution ?? 'dynamic',
    queryKey: {
      id: input.queryKeyId,
      display: input.display,
      segments: [input.display],
      matchMode: 'exact',
      resolution: input.resolution ?? 'dynamic',
      source: input.source,
    },
  };
}

test('pass-through query instance actions do not fan out to all declared query keys', () => {
  const file = '/repo/packages/vue-query/src/devtools/devtools.ts';
  const analysis: AnalysisResult = {
    records: [
      makeRecord({
        relation: 'declares',
        operation: 'useQuery',
        file,
        queryKeyId: 'foo|bar',
        display: '[foo, bar]',
        source: 'literal',
        resolution: 'static',
      }),
      makeRecord({
        relation: 'declares',
        operation: 'useQuery',
        file,
        queryKeyId: 'query-key',
        display: '[query-key]',
        source: 'literal',
        resolution: 'static',
      }),
      makeRecord({
        relation: 'invalidates',
        operation: 'invalidateQueries',
        file,
        queryKeyId: 'pass-through-query-key',
        display: '$queryKey',
        source: 'expression',
      }),
    ],
    scannedFiles: [],
    filesScanned: 1,
    parseErrors: [],
  };

  const graph = buildGraph(roots, analysis);
  const actionNode = graph.nodes.find((node) => node.kind === 'action' && node.label === 'invalidateQueries');
  assert.ok(actionNode);

  const relatedTargets = graph.edges.filter((edge) => edge.source === actionNode.id);
  assert.equal(relatedTargets.length, 0);
});
