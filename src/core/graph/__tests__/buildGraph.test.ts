import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildGraph } from '../buildGraph';
import { makeActionNodeId, makeQueryKeyNodeId } from '../nodeIds';
import type { NormalizedQueryKey } from '../../../shared/contracts';
import { createQueryRecord } from '../../../testing/fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

const key = (overrides: Partial<NormalizedQueryKey> = {}): NormalizedQueryKey => ({
  id: 'todos',
  display: '[todos]',
  segments: ['todos'],
  matchMode: 'exact',
  resolution: 'static',
  source: 'literal',
  ...overrides,
});

describe('core/graph/buildGraph', () => {
  it('links declared query keys through scoped actions and removes orphan inferred query nodes', () => {
    const roots = [{ name: 'workspace', path: '/repo' }];
    const declaredKey = key();
    const orphanKey = key({
      id: 'orphan',
      display: '[orphan]',
      segments: ['orphan'],
      resolution: 'dynamic',
      source: 'expression',
    });
    const wildcardKey = key({
      id: 'all-query-cache',
      display: 'ALL_QUERY_CACHE',
      segments: ['ALL_QUERY_CACHE'],
      matchMode: 'all',
      source: 'wildcard',
    });

    const graph = buildGraph(roots, {
      scannedFiles: [],
      filesScanned: 0,
      parseErrors: [{ file: '/repo/app/src/broken.ts', message: 'parse failed' }],
      records: [
        createQueryRecord({
          relation: 'declares',
          operation: 'useQuery',
          file: '/repo/app/src/hooks.ts',
          loc: { line: 3, column: 1 },
          queryKey: declaredKey,
          clientScopeId: 'client:one',
          executionScopeId: 'test:one',
          suiteScopeId: 'suite:one',
          declaresDirectly: true,
        }),
        createQueryRecord({
          relation: 'invalidates',
          operation: 'invalidateQueries',
          file: '/repo/app/src/action.ts',
          loc: { line: 10, column: 2 },
          queryKey: key({ matchMode: 'prefix' }),
          clientScopeId: 'client:one',
          executionScopeId: 'test:one',
        }),
        createQueryRecord({
          relation: 'clears',
          operation: 'clear',
          file: '/repo/app/src/other-test.ts',
          loc: { line: 11, column: 2 },
          queryKey: wildcardKey,
          executionScopeId: 'test:missing',
        }),
        createQueryRecord({
          relation: 'invalidates',
          operation: 'invalidateQueries',
          file: '/repo/app/src/other-execution.ts',
          loc: { line: 11, column: 3 },
          queryKey: wildcardKey,
          executionScopeId: 'test:missing',
        }),
        createQueryRecord({
          relation: 'clears',
          operation: 'clear',
          file: '/repo/app/src/suite.ts',
          loc: { line: 12, column: 2 },
          queryKey: wildcardKey,
          suiteScopeId: 'suite:one',
        }),
        createQueryRecord({
          relation: 'sets',
          operation: 'setQueryData',
          file: '/repo/app/src/orphan.ts',
          loc: { line: 13, column: 2 },
          queryKey: orphanKey,
        }),
        createQueryRecord({
          relation: 'invalidates',
          operation: 'invalidateQueries',
          file: '/repo/app/src/placeholder.ts',
          loc: { line: 14, column: 2 },
          queryKey: key({
            id: 'placeholder',
            display: '[$id]',
            segments: ['$id'],
            resolution: 'dynamic',
            source: 'expression',
          }),
        }),
        createQueryRecord({
          relation: 'declares',
          operation: 'useQuery',
          file: '/repo/app/src/placeholder-declare.ts',
          loc: { line: 15, column: 2 },
          queryKey: key({
            id: 'placeholder-declare',
            display: '[$declareId]',
            segments: ['$declareId'],
            resolution: 'dynamic',
            source: 'expression',
          }),
        }),
      ],
    });

    const queryNode = graph.nodes.find((node) => node.kind === 'queryKey' && node.label === declaredKey.display);
    const declaredNodeId = queryNode?.id ?? makeQueryKeyNodeId('workspace:.', declaredKey.display);
    const orphanNodeId = makeQueryKeyNodeId('workspace:app', orphanKey.display);

    expect(queryNode?.metrics).toMatchObject({
      affectedFiles: 4,
      declaredCallsites: 1,
      declaredFiles: 1,
      projectScope: 'workspace:app',
    });
    expect(graph.nodes.some((node) => node.id === orphanNodeId)).toBe(true);
    expect(graph.nodes.some((node) => node.kind === 'queryKey' && node.label === '[$id]')).toBe(false);
    expect(graph.edges.filter((edge) => edge.target === declaredNodeId).map((edge) => edge.relation)).toEqual(
      expect.arrayContaining(['declares', 'invalidates', 'clears']),
    );
    expect(
      graph.edges.some(
        (edge) => edge.relation === 'clears' && edge.source.includes('other-test.ts') && edge.target === declaredNodeId,
      ),
    ).toBe(false);
    expect(graph.summary).toMatchObject({ queryKeys: 2, parseErrors: 1 });
    expect(graph.parseErrors).toEqual([{ file: 'app/src/broken.ts', message: 'parse failed' }]);
  });

  it('falls back to the current working directory when no roots are provided', () => {
    const graph = buildGraph([], {
      scannedFiles: [],
      filesScanned: 0,
      parseErrors: [],
      records: [
        createQueryRecord({
          relation: 'declares',
          operation: 'useQuery',
          file: '/repo/app/src/hooks.ts',
          loc: { line: 3, column: 1 },
          queryKey: key(),
          declaresDirectly: true,
        }),
      ],
    });

    const fileNode = graph.nodes.find((node) => node.kind === 'file');
    expect(fileNode?.label).toBe(path.resolve('/repo/app/src/hooks.ts').split(path.sep).join('/'));
    expect(graph.summary).toMatchObject({ files: 1, actions: 1, queryKeys: 1, parseErrors: 0 });
  });

  it('filters wildcard and matched actions by client and suite scope fallbacks', () => {
    const roots = [{ name: 'workspace', path: '/repo' }];
    const emptySegmentKey = key({
      id: 'empty',
      display: '[]',
      segments: [],
    });
    const detailKey = key({
      id: 'todos-detail',
      display: '[todos, detail]',
      segments: ['todos', 'detail'],
      matchMode: 'exact',
    });
    const wildcardKey = key({
      id: 'all-query-cache',
      display: 'ALL_QUERY_CACHE',
      segments: ['ALL_QUERY_CACHE'],
      matchMode: 'all',
      source: 'wildcard',
    });

    const graph = buildGraph(roots, {
      scannedFiles: [],
      filesScanned: 0,
      parseErrors: [],
      records: [
        createQueryRecord({
          relation: 'declares',
          operation: 'useQuery',
          file: '/repo/app/src/empty.ts',
          loc: { line: 1, column: 1 },
          queryKey: emptySegmentKey,
          clientScopeId: 'client:empty',
          declaresDirectly: true,
        }),
        createQueryRecord({
          relation: 'declares',
          operation: 'useQuery',
          file: '/repo/app/src/detail.ts',
          loc: { line: 2, column: 1 },
          queryKey: detailKey,
          clientScopeId: 'client:detail',
          suiteScopeId: 'suite:detail',
          declaresDirectly: true,
        }),
        createQueryRecord({
          relation: 'invalidates',
          operation: 'invalidateQueries',
          file: '/repo/app/src/client-action.ts',
          loc: { line: 3, column: 1 },
          queryKey: detailKey,
          clientScopeId: 'client:detail',
        }),
        createQueryRecord({
          relation: 'clears',
          operation: 'clear',
          file: '/repo/app/src/missing-suite.ts',
          loc: { line: 4, column: 1 },
          queryKey: wildcardKey,
          suiteScopeId: 'suite:missing',
        }),
        createQueryRecord({
          relation: 'invalidates',
          operation: 'invalidateQueries',
          file: '/repo/app/src/missing-suite-fallback.ts',
          loc: { line: 4, column: 2 },
          queryKey: wildcardKey,
          suiteScopeId: 'suite:missing',
        }),
        createQueryRecord({
          relation: 'invalidates',
          operation: 'invalidateQueries',
          file: '/repo/other/src/action.ts',
          loc: { line: 5, column: 1 },
          queryKey: detailKey,
        }),
      ],
    });

    const emptyNode = graph.nodes.find((node) => node.kind === 'queryKey' && node.label === '[]');
    const detailNode = graph.nodes.find((node) => node.kind === 'queryKey' && node.label === '[todos, detail]');
    expect(emptyNode?.metrics?.rootSegment).toBe('unknown');
    expect(detailNode?.metrics).toMatchObject({
      affectedFiles: 3,
      declaredCallsites: 1,
      projectScope: 'workspace:app',
    });
    expect(
      graph.edges.some(
        (edge) =>
          edge.relation === 'clears' && edge.source.startsWith('action:') && edge.source.includes('missing-suite.ts'),
      ),
    ).toBe(false);
    expect(graph.edges.some((edge) => edge.relation === 'invalidates' && edge.source.includes('/other/'))).toBe(true);
  });

  it('exercises duplicate declare, cross-project wildcard, project-mismatch non-wildcard, orphan queryKey node, and multi-file declare paths', () => {
    const roots = [{ name: 'ws', path: '/repo' }];
    const sharedKey = key({
      id: 'shared',
      display: '[shared]',
      segments: ['shared'],
      matchMode: 'exact',
    });
    // A prefix key whose display differs from the declared key so it gets its own node
    const prefixActionKey = key({
      id: 'prefix-action',
      display: '[shared, detail]',
      segments: ['shared', 'detail'],
      matchMode: 'prefix',
    });
    const otherProjectKey = key({
      id: 'other-proj',
      display: '[other]',
      segments: ['other'],
      matchMode: 'prefix',
    });
    const wildcardKey = key({
      id: 'all-query-cache',
      display: 'ALL_QUERY_CACHE',
      segments: ['ALL_QUERY_CACHE'],
      matchMode: 'all',
      source: 'wildcard',
    });

    const graph = buildGraph(roots, {
      scannedFiles: [],
      filesScanned: 0,
      parseErrors: [],
      records: [
        // B15: first declare — sets declaredQueryKeyByNodeId
        createQueryRecord({
          relation: 'declares',
          operation: 'useQuery',
          file: '/repo/pkg-a/src/hooks1.ts',
          loc: { line: 1, column: 1 },
          queryKey: sharedKey,
          declaresDirectly: true,
          clientScopeId: 'client:a',
          executionScopeId: 'exec:a',
          suiteScopeId: 'suite:a',
        }),
        // B15: second declare of same queryKey — exercises !has() false branch (line 103)
        // B50: second declare from different file — exercises queryKeyToDeclareFiles.has() true branch (line 269)
        createQueryRecord({
          relation: 'declares',
          operation: 'useQuery',
          file: '/repo/pkg-a/src/hooks2.ts',
          loc: { line: 2, column: 1 },
          queryKey: sharedKey,
          declaresDirectly: true,
          clientScopeId: 'client:a',
        }),
        // B44: non-wildcard action in pkg-b referencing a key declared only in pkg-a → project mismatch
        // matchedTargets = [] → falls back to own queryKeyNodeId
        createQueryRecord({
          relation: 'invalidates',
          operation: 'invalidateQueries',
          file: '/repo/pkg-b/src/action.ts',
          loc: { line: 3, column: 1 },
          queryKey: otherProjectKey,
        }),
        // B58 setup: prefix action key whose segments prefix-match sharedKey → matchedTargets=[sharedKeyNodeId]
        // filterTargetsByScope returns [sharedKeyNodeId], so prefixActionKey's own node never targeted
        // → queryKeyToFiles.get(prefixActionKeyNodeId) = undefined → branch B58
        createQueryRecord({
          relation: 'invalidates',
          operation: 'invalidateQueries',
          file: '/repo/pkg-a/src/prefix-action.ts',
          loc: { line: 4, column: 1 },
          queryKey: prefixActionKey,
        }),
        // B33: wildcard with executionScopeId and operation != 'clear' → strictWhenScoped=false
        // (existing test only covers operation='clear' with executionScopeId where strict=true)
        createQueryRecord({
          relation: 'invalidates',
          operation: 'invalidateQueries',
          file: '/repo/pkg-a/src/wildcard-exec.ts',
          loc: { line: 5, column: 1 },
          queryKey: wildcardKey,
          executionScopeId: 'exec:a',
        }),
        // B38: wildcard action from pkg-b — declared keys are in pkg-a → projects.has() false
        createQueryRecord({
          relation: 'invalidates',
          operation: 'invalidateQueries',
          file: '/repo/pkg-b/src/wildcard-cross.ts',
          loc: { line: 6, column: 1 },
          queryKey: wildcardKey,
        }),
      ],
    });

    // The shared key should have two declared files (hooks1 and hooks2)
    const sharedNode = graph.nodes.find((n) => n.kind === 'queryKey' && n.label === '[shared]');
    expect(sharedNode).toBeDefined();
    expect(sharedNode?.metrics?.declaredFiles).toBe(2);
    expect(sharedNode?.metrics?.declaredCallsites).toBe(2);

    // pkg-b action with 'other' key — no match in any project, fallback to own key node
    const otherNode = graph.nodes.find((n) => n.kind === 'queryKey' && n.label === '[other]');
    expect(otherNode).toBeDefined();
    expect(otherNode?.metrics?.affectedFiles).toBeGreaterThanOrEqual(1);

    // wildcard with exec scope (non-clear) should link to sharedKey in same project
    const sharedEdges = graph.edges.filter((e) => e.target === sharedNode?.id && e.relation === 'invalidates');
    expect(sharedEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps fallback action keys and filters strict scoped wildcard links', () => {
    const roots = [{ name: 'workspace', path: '/repo' }];
    const declared = key({
      id: 'declared',
      display: '[declared]',
      segments: ['declared'],
    });
    const unmatched = key({
      id: 'unmatched',
      display: '[unmatched]',
      segments: ['unmatched'],
      matchMode: 'exact',
    });
    const wildcard = key({
      id: 'all-query-cache',
      display: 'ALL_QUERY_CACHE',
      segments: ['ALL_QUERY_CACHE'],
      matchMode: 'all',
      source: 'wildcard',
    });

    const graph = buildGraph(roots, {
      scannedFiles: [],
      filesScanned: 0,
      parseErrors: [],
      records: [
        createQueryRecord({
          relation: 'declares',
          operation: 'useQuery',
          file: '/repo/pkg-a/src/query.ts',
          loc: { line: 1, column: 1 },
          queryKey: declared,
          declaresDirectly: true,
          clientScopeId: 'client:a',
        }),
        createQueryRecord({
          relation: 'invalidates',
          operation: 'invalidateQueries',
          file: '/repo/pkg-a/src/action.ts',
          loc: { line: 2, column: 1 },
          queryKey: unmatched,
          clientScopeId: 'client:missing',
        }),
        createQueryRecord({
          relation: 'invalidates',
          operation: 'invalidateQueries',
          file: '/repo/pkg-a/src/action.ts',
          loc: { line: 2, column: 1 },
          queryKey: unmatched,
          clientScopeId: 'client:missing',
        }),
        createQueryRecord({
          relation: 'clears',
          operation: 'clear',
          file: '/repo/pkg-a/src/strict.ts',
          loc: { line: 3, column: 1 },
          queryKey: wildcard,
          executionScopeId: 'test:missing',
        }),
      ],
    });

    const unmatchedNode = graph.nodes.find((node) => node.kind === 'queryKey' && node.label === '[unmatched]');
    expect(unmatchedNode?.metrics).toMatchObject({
      affectedFiles: 1,
      declaredCallsites: 0,
      projectScope: 'workspace:pkg-a',
    });
    expect(
      graph.edges.filter((edge) => edge.target === unmatchedNode?.id && edge.relation === 'invalidates'),
    ).toHaveLength(2);
    expect(
      graph.edges.some(
        (edge) => edge.relation === 'clears' && edge.source.includes('strict.ts') && edge.target.startsWith('query:'),
      ),
    ).toBe(false);
  });

  it('covers missing declaration cache and project-count fallback branches', () => {
    const roots = [{ name: 'workspace', path: '/repo' }];
    const declared = key({
      id: 'declared',
      display: '[declared]',
      segments: ['declared'],
      matchMode: 'exact',
    });
    const action = createQueryRecord({
      relation: 'invalidates',
      operation: 'invalidateQueries',
      file: '/repo/pkg-a/src/action.ts',
      loc: { line: 10, column: 2 },
      queryKey: declared,
    });
    const declaredRecord = createQueryRecord({
      relation: 'declares',
      operation: 'useQuery',
      file: '/repo/pkg-a/src/hooks.ts',
      loc: { line: 3, column: 1 },
      queryKey: declared,
      declaresDirectly: true,
    });
    const queryNodeId = makeQueryKeyNodeId('workspace:pkg-a', declared.display);
    const originalGet = Map.prototype.get;
    vi.spyOn(Map.prototype, 'get').mockImplementation(function (this: Map<unknown, unknown>, key: unknown) {
      const value = originalGet.call(this, key);
      if (key === queryNodeId) {
        if (value instanceof Map) {
          return undefined;
        }
        if (value && typeof value === 'object' && 'display' in value) {
          return undefined;
        }
      }
      return value;
    });

    const graph = buildGraph(roots, {
      scannedFiles: [],
      filesScanned: 0,
      parseErrors: [],
      records: [declaredRecord, action],
    });

    expect(
      graph.nodes.find((node) => node.kind === 'queryKey' && node.label === declared.display)?.metrics,
    ).toMatchObject({
      declaredFiles: 1,
      projectScope: 'workspace:pkg-a',
    });
    expect(graph.edges.some((edge) => edge.source === makeActionNodeId(action, 1))).toBe(true);
  });

  it('covers dangling-node edge skips', () => {
    const roots = [{ name: 'workspace', path: '/repo' }];
    const declared = key({
      id: 'declared-dangling',
      display: '[declared-dangling]',
      segments: ['declared-dangling'],
      matchMode: 'exact',
    });
    const action = createQueryRecord({
      relation: 'invalidates',
      operation: 'invalidateQueries',
      file: '/repo/pkg-a/src/action.ts',
      loc: { line: 10, column: 2 },
      queryKey: declared,
    });
    const actionNodeId = makeActionNodeId(action, 0);
    const originalGet = Map.prototype.get;
    vi.spyOn(Map.prototype, 'get').mockImplementation(function (this: Map<unknown, unknown>, key: unknown) {
      const value = originalGet.call(this, key);
      if (
        value &&
        typeof value === 'object' &&
        'kind' in value &&
        (value as { kind?: string; label?: string }).kind === 'queryKey' &&
        (value as { kind?: string; label?: string }).label === declared.display
      ) {
        return undefined;
      }
      return value;
    });

    const graph = buildGraph(roots, {
      scannedFiles: [],
      filesScanned: 0,
      parseErrors: [],
      records: [action],
    });

    expect(graph.nodes.some((node) => node.id === actionNodeId)).toBe(true);
  });

  it('covers missing action-to-file linkage fallback', () => {
    const roots = [{ name: 'workspace', path: '/repo' }];
    const declared = key({
      id: 'declared-linked',
      display: '[declared-linked]',
      segments: ['declared-linked'],
      matchMode: 'exact',
    });
    const action = createQueryRecord({
      relation: 'invalidates',
      operation: 'invalidateQueries',
      file: '/repo/pkg-a/src/action.ts',
      loc: { line: 10, column: 2 },
      queryKey: declared,
    });
    const actionNodeId = makeActionNodeId(action, 1);
    const originalGet = Map.prototype.get;
    vi.spyOn(Map.prototype, 'get').mockImplementation(function (this: Map<unknown, unknown>, key: unknown) {
      const value = originalGet.call(this, key);
      if (key === actionNodeId && value instanceof Set) {
        return undefined;
      }
      return value;
    });

    const graph = buildGraph(roots, {
      scannedFiles: [],
      filesScanned: 0,
      parseErrors: [],
      records: [
        createQueryRecord({
          relation: 'declares',
          operation: 'useQuery',
          file: '/repo/pkg-a/src/hooks.ts',
          loc: { line: 3, column: 1 },
          queryKey: declared,
          declaresDirectly: true,
        }),
        action,
      ],
    });

    expect(graph.nodes.some((node) => node.id === actionNodeId)).toBe(true);
    expect(graph.edges.some((edge) => edge.source === actionNodeId && edge.target.startsWith('qk:'))).toBe(true);
  });
});
