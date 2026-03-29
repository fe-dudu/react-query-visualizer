import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGraph } from '../src/core/graphBuilder';
import type { AnalysisResult, GraphData, QueryRecord } from '../src/types';
import { computeVisibleGraph } from '../src/webview/graphUtils';
import type { FilterState } from '../src/webview/viewTypes';

const roots = [{ name: 'repo', path: '/repo' }];

function makeRecord(input: {
  relation: QueryRecord['relation'];
  operation: string;
  file: string;
  queryKeyId: string;
}): QueryRecord {
  return {
    relation: input.relation,
    operation: input.operation,
    file: input.file,
    loc: { line: 1, column: 1 },
    resolution: 'static',
    queryKey: {
      id: input.queryKeyId,
      display: input.queryKeyId,
      segments: [input.queryKeyId],
      matchMode: 'exact',
      resolution: 'static',
      source: 'literal',
    },
  };
}

function makeFilters(overrides: Partial<FilterState> = {}): FilterState {
  return {
    relation: {
      invalidates: true,
      refetches: false,
      cancels: false,
      resets: false,
      removes: false,
      sets: false,
      clears: false,
    },
    fileQuery: '',
    search: '',
    ...overrides,
  };
}

function makeGraph(): GraphData {
  const analysis: AnalysisResult = {
    records: [
      makeRecord({
        relation: 'declares',
        operation: 'useQuery',
        file: '/repo/packages/a/src/query.ts',
        queryKeyId: 'todos',
      }),
      makeRecord({
        relation: 'declares',
        operation: 'useQuery',
        file: '/repo/packages/b/src/query.ts',
        queryKeyId: 'posts',
      }),
      makeRecord({
        relation: 'invalidates',
        operation: 'invalidateQueries',
        file: '/repo/packages/a/src/mutation.ts',
        queryKeyId: 'todos',
      }),
      makeRecord({
        relation: 'invalidates',
        operation: 'invalidateQueries',
        file: '/repo/packages/b/src/mutation.ts',
        queryKeyId: 'posts',
      }),
    ],
    scannedFiles: [],
    filesScanned: 4,
    parseErrors: [],
  };

  return buildGraph(roots, analysis);
}

test('computeVisibleGraph returns empty graph when all operation filters are disabled', () => {
  const visible = computeVisibleGraph(
    makeGraph(),
    makeFilters({
      relation: {
        invalidates: false,
        refetches: false,
        cancels: false,
        resets: false,
        removes: false,
        sets: false,
        clears: false,
      },
    }),
  );

  assert.equal(visible.nodes.length, 0);
  assert.equal(visible.edges.length, 0);
  assert.deepEqual(visible.summary, {
    files: 0,
    actions: 0,
    queryKeys: 0,
    parseErrors: 0,
  });
});

test('computeVisibleGraph keeps only the matched file-action-query chain for file filters', () => {
  const visible = computeVisibleGraph(
    makeGraph(),
    makeFilters({
      fileQuery: 'packages/a',
    }),
  );

  assert.equal(visible.nodes.filter((node) => node.kind === 'file').length, 1);
  assert.equal(visible.nodes.filter((node) => node.kind === 'action').length, 1);
  assert.equal(visible.nodes.filter((node) => node.kind === 'queryKey').length, 1);
  assert.match(visible.nodes.find((node) => node.kind === 'file')?.label ?? '', /packages\/a/);
  assert.equal(visible.nodes.find((node) => node.kind === 'queryKey')?.label, 'todos');
});
