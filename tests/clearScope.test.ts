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
  clientScopeId?: string;
  executionScopeId?: string;
  suiteScopeId?: string;
  resolution?: QueryRecord['queryKey']['resolution'];
  matchMode?: QueryRecord['queryKey']['matchMode'];
}): QueryRecord {
  return {
    relation: input.relation,
    operation: input.operation,
    file: input.file,
    loc: { line: 1, column: 1 },
    resolution: input.resolution ?? 'dynamic',
    clientScopeId: input.clientScopeId,
    executionScopeId: input.executionScopeId,
    suiteScopeId: input.suiteScopeId,
    queryKey: {
      id: input.queryKeyId,
      display: input.display,
      segments: [input.display],
      matchMode: input.matchMode ?? 'exact',
      resolution: input.resolution ?? 'dynamic',
      source: input.source,
    },
  };
}

test('clear does not fall back to all project query keys when no same-scope declarations exist', () => {
  const file = '/repo/packages/vue-query/src/__tests__/useMutationState.test.ts';
  const analysis: AnalysisResult = {
    records: [
      makeRecord({
        relation: 'declares',
        operation: 'useQuery',
        file,
        queryKeyId: 'key',
        display: '[key]',
        source: 'literal',
        clientScopeId: `${file}:10:1:queryClient`,
        executionScopeId: `${file}:10:1:it`,
        suiteScopeId: `${file}:1:1:describe`,
        resolution: 'static',
      }),
      makeRecord({
        relation: 'clears',
        operation: 'clear',
        file,
        queryKeyId: 'all-query-cache',
        display: 'ALL_QUERY_CACHE (clear all)',
        source: 'wildcard',
        clientScopeId: `${file}:39:11:queryClient`,
        executionScopeId: `${file}:38:3:it`,
        suiteScopeId: `${file}:1:1:describe`,
        matchMode: 'all',
      }),
    ],
    scannedFiles: [],
    filesScanned: 1,
    parseErrors: [],
  };

  const graph = buildGraph(roots, analysis);
  const actionNode = graph.nodes.find((node) => node.kind === 'action' && node.label === 'clear');
  assert.ok(actionNode);
  assert.equal(graph.edges.filter((edge) => edge.source === actionNode.id).length, 0);
});

test('clear in non-test files still falls back to project query keys', () => {
  const file = '/repo/src/ageAssurance/data.tsx';
  const analysis: AnalysisResult = {
    records: [
      makeRecord({
        relation: 'declares',
        operation: 'useQuery',
        file,
        queryKeyId: 'config',
        display: '[config]',
        source: 'literal',
        clientScopeId: `${file}:36:7:qc`,
        resolution: 'static',
      }),
      makeRecord({
        relation: 'clears',
        operation: 'clear',
        file,
        queryKeyId: 'all-query-cache',
        display: 'ALL_QUERY_CACHE (clear all)',
        source: 'wildcard',
        clientScopeId: `${file}:36:7:qc`,
        matchMode: 'all',
      }),
    ],
    scannedFiles: [],
    filesScanned: 1,
    parseErrors: [],
  };

  const graph = buildGraph(roots, analysis);
  const actionNode = graph.nodes.find((node) => node.kind === 'action' && node.label === 'clear');
  assert.ok(actionNode);
  assert.deepEqual(
    graph.edges
      .filter((edge) => edge.source === actionNode.id)
      .map((edge) => graph.nodes.find((node) => node.id === edge.target)?.label)
      .filter((label): label is string => Boolean(label)),
    ['[config]'],
  );
});
