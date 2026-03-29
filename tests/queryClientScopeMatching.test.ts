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
  display?: string;
  clientScopeId?: string;
  executionScopeId?: string;
  suiteScopeId?: string;
  matchMode?: QueryRecord['queryKey']['matchMode'];
  resolution?: QueryRecord['queryKey']['resolution'];
  source?: QueryRecord['queryKey']['source'];
}): QueryRecord {
  return {
    relation: input.relation,
    operation: input.operation,
    file: input.file,
    loc: { line: 1, column: 1 },
    resolution: input.resolution ?? 'static',
    clientScopeId: input.clientScopeId,
    executionScopeId: input.executionScopeId,
    suiteScopeId: input.suiteScopeId,
    queryKey: {
      id: input.queryKeyId,
      display: input.display ?? `[${input.queryKeyId}]`,
      segments: [input.queryKeyId],
      matchMode: input.matchMode ?? 'exact',
      resolution: input.resolution ?? 'static',
      source: input.source ?? (input.resolution === 'dynamic' ? 'expression' : 'literal'),
    },
  };
}

test('wildcard client actions prefer declared query keys from the same client scope', () => {
  const file = '/repo/packages/query-core/src/__tests__/queryClient.test-d.tsx';
  const analysis: AnalysisResult = {
    records: [
      makeRecord({
        relation: 'declares',
        operation: 'fetchQuery',
        file,
        queryKeyId: 'string',
        display: '[string]',
        clientScopeId: 'client:a',
      }),
      makeRecord({
        relation: 'declares',
        operation: 'fetchQuery',
        file,
        queryKeyId: 'number',
        display: '[number]',
        clientScopeId: 'client:b',
      }),
      makeRecord({
        relation: 'invalidates',
        operation: 'invalidateQueries',
        file,
        queryKeyId: 'all-query-cache',
        display: 'ALL_QUERY_CACHE',
        clientScopeId: 'client:a',
        matchMode: 'all',
        resolution: 'dynamic',
        source: 'wildcard',
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

  assert.deepEqual(relatedQueryLabels, ['[string]']);
});

test('wildcard actions prefer declared query keys from the same test callback scope', () => {
  const file = '/repo/packages/query-core/src/__tests__/queryObserver.test.tsx';
  const analysis: AnalysisResult = {
    records: [
      makeRecord({
        relation: 'declares',
        operation: 'useQuery',
        file,
        queryKeyId: 'query_${' + 'queryKeyCount}',
        display: '[query_${' + 'queryKeyCount}]',
        clientScopeId: `${file}:20:5:queryClient`,
        executionScopeId: `${file}:90:5:test`,
        suiteScopeId: `${file}:64:3:describe`,
        resolution: 'dynamic',
      }),
      makeRecord({
        relation: 'declares',
        operation: 'useQuery',
        file,
        queryKeyId: 'string',
        display: '[string]',
        clientScopeId: `${file}:20:5:queryClient`,
        executionScopeId: `${file}:140:5:test`,
        suiteScopeId: `${file}:64:3:describe`,
      }),
      makeRecord({
        relation: 'invalidates',
        operation: 'invalidateQueries',
        file,
        queryKeyId: 'all-query-cache',
        display: 'ALL_QUERY_CACHE',
        clientScopeId: `${file}:20:5:queryClient`,
        executionScopeId: `${file}:90:5:test`,
        suiteScopeId: `${file}:64:3:describe`,
        matchMode: 'all',
        resolution: 'dynamic',
        source: 'wildcard',
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
