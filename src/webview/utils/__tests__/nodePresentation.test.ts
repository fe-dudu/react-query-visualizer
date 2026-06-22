import { describe, expect, it } from 'vitest';

import {
  actionLabel,
  fileRef,
  filterActionQueryLabels,
  isOperationRelation,
  nodeMatchesSearch,
  sortActionNodesByOperation,
  sortCallsites,
  sortFileRefs,
  summarizeVisibleGraph,
} from '../nodePresentation';
import { createGraph, createGraphNode } from '../../../testing/fixtures';

describe('webview/utils/nodePresentation', () => {
  it('summarizes and matches nodes', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({ id: 'file', kind: 'file', label: 'src/file.ts', resolution: 'static' }),
        createGraphNode({
          id: 'action',
          kind: 'action',
          label: 'invalidate',
          file: 'src/file.ts',
          resolution: 'static',
          loc: { line: 5, column: 2 },
          metrics: { relation: 'invalidates', displayFile: 'src/file.ts' },
        }),
        createGraphNode({ id: 'query', kind: 'queryKey', label: 'todo', resolution: 'dynamic' }),
      ],
      edges: [],
      parseErrors: [{ file: 'bad.ts', message: 'oops' }],
    });

    expect(summarizeVisibleGraph(graph)).toEqual({
      files: 1,
      actions: 1,
      queryKeys: 1,
      parseErrors: 1,
    });

    const fileNode = graph.nodes[0];
    if (!fileNode) {
      throw new Error('Missing file node');
    }

    expect(nodeMatchesSearch(fileNode, 'src/file')).toBe(true);
    expect(nodeMatchesSearch(fileNode, 'missing')).toBe(false);
  });

  it('sorts action nodes, refs, and callsites', () => {
    const actions = sortActionNodesByOperation([
      createGraphNode({
        id: 'a2',
        kind: 'action',
        label: 'b',
        file: 'src/b.ts',
        resolution: 'static',
        loc: { line: 2, column: 1 },
        metrics: { relation: 'sets' },
      }),
      createGraphNode({
        id: 'a1',
        kind: 'action',
        label: 'a',
        file: 'src/a.ts',
        resolution: 'static',
        loc: { line: 1, column: 5 },
        metrics: { relation: 'invalidates' },
      }),
    ]);
    expect(actions.map((node) => node.id)).toEqual(['a1', 'a2']);
    const firstAction = actions[0];
    if (!firstAction) {
      throw new Error('Missing first action');
    }

    expect(actionLabel(firstAction)).toEqual({
      label: 'a in src/a.ts @ 1:5',
      file: 'src/a.ts',
      line: 1,
      column: 5,
      relation: 'invalidates',
    });

    expect(fileRef('x', 'src/a.ts', 1, 1)).toEqual({ label: 'x', file: 'src/a.ts', line: 1, column: 1 });
    expect(sortFileRefs([fileRef('b'), fileRef('a')]).map((item) => item.label)).toEqual(['a', 'b']);
    expect(
      sortCallsites([
        { label: 'b', file: 'src/b.ts', line: 2, column: 2, relation: 'sets' },
        { label: 'a', file: 'src/a.ts', line: 1, column: 1, relation: 'invalidates' },
      ]).map((item) => item.label),
    ).toEqual(['a', 'b']);
  });

  it('filters action query labels and operation relations', () => {
    expect(filterActionQueryLabels(['$id', '$id', 'todos', '[$params]'])).toEqual(['todos']);
    expect(filterActionQueryLabels(['$id', '[$params]'])).toEqual(['$id', '[$params]']);
    expect(isOperationRelation('invalidates')).toBe(true);
    expect(isOperationRelation('declares')).toBe(false);
  });

  it('covers empty searches and fallback ordering branches', () => {
    expect(
      nodeMatchesSearch(
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'src/file.ts',
          resolution: 'static',
        }),
        '',
      ),
    ).toBe(true);

    const ordered = sortActionNodesByOperation([
      createGraphNode({
        id: 'same-b',
        kind: 'action',
        label: 'same-b',
        file: 'src/same.ts',
        resolution: 'static',
        loc: { line: 1, column: 1 },
        metrics: { relation: 'sets' },
      }),
      createGraphNode({
        id: 'same-a',
        kind: 'action',
        label: 'same-a',
        file: 'src/same.ts',
        resolution: 'static',
        loc: { line: 1, column: 1 },
        metrics: { relation: 'sets' },
      }),
      createGraphNode({
        id: 'c',
        kind: 'action',
        label: 'c',
        file: 'src/a.ts',
        resolution: 'static',
        loc: { line: 3, column: 1 },
        metrics: { relation: 'sets' },
      }),
      createGraphNode({
        id: 'missing-line',
        kind: 'action',
        label: 'missing-line',
        file: 'src/a.ts',
        resolution: 'static',
        metrics: { relation: 'sets' },
      }),
      createGraphNode({
        id: 'missing-column',
        kind: 'action',
        label: 'missing-column',
        file: 'src/a.ts',
        resolution: 'static',
        loc: { line: 3, column: undefined as never },
        metrics: { relation: 'sets' },
      }),
      createGraphNode({
        id: 'a',
        kind: 'action',
        label: 'a',
        file: 'src/a.ts',
        resolution: 'static',
        loc: { line: 1, column: 9 },
        metrics: { relation: 'sets' },
      }),
      createGraphNode({
        id: 'b',
        kind: 'action',
        label: 'b',
        file: 'src/a.ts',
        resolution: 'static',
        loc: { line: 1, column: 2 },
        metrics: { relation: 'sets' },
      }),
      createGraphNode({
        id: 'z',
        kind: 'action',
        label: 'z',
        file: 'src/z.ts',
        resolution: 'static',
        metrics: { relation: 'unknown' as never },
      }),
    ]);
    expect(ordered.map((node) => node.id)).toEqual([
      'b',
      'a',
      'c',
      'missing-column',
      'missing-line',
      'same-a',
      'same-b',
      'z',
    ]);

    expect(
      actionLabel(
        createGraphNode({
          id: 'no-loc',
          kind: 'action',
          label: 'invalidate',
          file: 'src/file.ts',
          resolution: 'static',
          metrics: {},
        }),
      ),
    ).toMatchObject({
      label: 'invalidate in src/file.ts @ -',
      file: 'src/file.ts',
      line: undefined,
      column: undefined,
    });

    expect(
      sortCallsites([
        { label: 'b', relation: 'sets' },
        { label: 'a', file: 'src/a.ts', line: 1, column: 2, relation: 'invalidates' },
        { label: 'c', file: 'src/a.ts', line: 1, column: 1, relation: 'invalidates' },
        { label: 'no-line', file: 'src/a.ts', relation: 'sets' },
        { label: 'no-column', file: 'src/a.ts', line: 1, relation: 'sets' },
        { label: 'e', file: 'src/e.ts', relation: 'sets' },
        { label: 'd', file: 'src/e.ts', relation: 'sets' },
      ]).map((item) => item.label),
    ).toEqual(['b', 'c', 'a', 'no-column', 'no-line', 'd', 'e']);
    expect(
      sortActionNodesByOperation([
        createGraphNode({
          id: 'no-column-first',
          kind: 'action',
          label: 'no-column-first',
          file: 'src/a.ts',
          resolution: 'static',
          loc: { line: 1, column: undefined as never },
          metrics: { relation: 'sets' },
        }),
        createGraphNode({
          id: 'column-second',
          kind: 'action',
          label: 'column-second',
          file: 'src/a.ts',
          resolution: 'static',
          loc: { line: 1, column: 1 },
          metrics: { relation: 'sets' },
        }),
      ]).map((node) => node.id),
    ).toEqual(['column-second', 'no-column-first']);
    expect(
      sortCallsites([
        { label: 'with-file', file: 'src/a.ts', relation: 'sets' },
        { label: 'without-file', relation: 'sets' },
      ]).map((item) => item.label),
    ).toEqual(['without-file', 'with-file']);
    expect(sortFileRefs([fileRef('b', 'b'), fileRef('a')]).map((entry) => entry.label)).toEqual(['a', 'b']);
    expect(filterActionQueryLabels(['$a', '[$b]'])).toEqual(['$a', '[$b]']);
    expect(filterActionQueryLabels(['', '   '])).toEqual(['', '   ']);
  });
});
