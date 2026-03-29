import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGraph } from '../src/core/graphBuilder';
import type { AnalysisResult, QueryRecord } from '../src/types';

const roots = [{ name: 'repo', path: '/repo' }];

function makeRecord(input: {
  relation: QueryRecord['relation'];
  operation: string;
  file: string;
  id: string;
  display: string;
  segments: string[];
  matchMode: QueryRecord['queryKey']['matchMode'];
  resolution?: QueryRecord['queryKey']['resolution'];
}): QueryRecord {
  return {
    relation: input.relation,
    operation: input.operation,
    file: input.file,
    loc: { line: 1, column: 1 },
    resolution: input.resolution ?? 'dynamic',
    queryKey: {
      id: input.id,
      display: input.display,
      segments: input.segments,
      matchMode: input.matchMode,
      resolution: input.resolution ?? 'dynamic',
      source: 'expression',
    },
  };
}

test('dynamic template action keys do not fan out to unrelated dynamic query keys', () => {
  const analysis: AnalysisResult = {
    records: [
      makeRecord({
        relation: 'declares',
        operation: 'useQuery',
        file: '/repo/packages/a/useQuery.test.tsx',
        id: 'query_${' + 'queryKeyCount}',
        display: '[query_${' + 'queryKeyCount}]',
        segments: ['query_${' + 'queryKeyCount}'],
        matchMode: 'exact',
      }),
      makeRecord({
        relation: 'declares',
        operation: 'useQuery',
        file: '/repo/packages/a/useQuery.test.tsx',
        id: '$key',
        display: '$key',
        segments: ['$key'],
        matchMode: 'exact',
      }),
      makeRecord({
        relation: 'declares',
        operation: 'useQuery',
        file: '/repo/packages/a/useQuery.test.tsx',
        id: 'string',
        display: '[string]',
        segments: ['string'],
        matchMode: 'exact',
        resolution: 'static',
      }),
      makeRecord({
        relation: 'invalidates',
        operation: 'invalidateQueries',
        file: '/repo/packages/a/useQuery.test.tsx',
        id: 'query_${' + 'queryKeyCount}',
        display: '[query_${' + 'queryKeyCount}]',
        segments: ['query_${' + 'queryKeyCount}'],
        matchMode: 'exact',
      }),
    ],
    scannedFiles: [],
    filesScanned: 1,
    parseErrors: [],
  };

  const graph = buildGraph(roots, analysis);
  const actionNode = graph.nodes.find((node) => node.kind === 'action' && node.label === 'invalidateQueries');
  assert.ok(actionNode);

  const relatedQueryLabels = graph.edges
    .filter((edge) => edge.source === actionNode.id)
    .map((edge) => graph.nodes.find((node) => node.id === edge.target)?.label)
    .filter((label): label is string => Boolean(label))
    .sort((left, right) => left.localeCompare(right));

  assert.deepEqual(relatedQueryLabels, ['[query_${' + 'queryKeyCount}]']);
});
