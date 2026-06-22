import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  actionAffectsDeclaredQueryKey,
  isDeclarationAnchorRecord,
  isOpaqueDynamicQueryKey,
  isPlaceholderOnlyQueryKey,
  isSetAnchoredConcreteKey,
  isWildcardQueryKey,
} from '../queryKeyMatching';
import { createQueryRecord } from '../../../testing/fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

const queryKey = (overrides: Partial<ReturnType<typeof createQueryRecord>['queryKey']>) => ({
  id: 'id',
  display: 'display',
  segments: ['a', 'b'],
  matchMode: 'prefix' as const,
  resolution: 'static' as const,
  source: 'literal' as const,
  ...overrides,
});

describe('core/graph/queryKeyMatching', () => {
  it('recognizes wildcard and declaration keys', () => {
    expect(
      isWildcardQueryKey(
        createQueryRecord({
          relation: 'invalidates',
          operation: 'invalidateQueries',
          file: 'src/file.ts',
          loc: { line: 1, column: 1 },
          queryKey: queryKey({ source: 'wildcard' }),
        }),
      ),
    ).toBe(true);
    expect(
      isWildcardQueryKey(
        createQueryRecord({
          relation: 'invalidates',
          operation: 'invalidateQueries',
          file: 'src/file.ts',
          loc: { line: 1, column: 1 },
          queryKey: queryKey({ id: 'all-query-cache' }),
        }),
      ),
    ).toBe(true);
    expect(
      isDeclarationAnchorRecord(
        createQueryRecord({
          relation: 'declares',
          operation: 'x',
          file: 'src/file.ts',
          loc: { line: 1, column: 1 },
          queryKey: queryKey({}),
        }),
      ),
    ).toBe(true);
  });

  it('detects placeholder-only and opaque dynamic query keys', () => {
    expect(isPlaceholderOnlyQueryKey(queryKey({ segments: ['$id', 'UNRESOLVED'] }))).toBe(true);
    expect(isPlaceholderOnlyQueryKey(queryKey({ segments: ['todo', '$id'] }))).toBe(false);
    expect(isOpaqueDynamicQueryKey(queryKey({ segments: ['$', 'UNRESOLVED'] }))).toBe(true);
    expect(isOpaqueDynamicQueryKey(queryKey({ source: 'wildcard' }))).toBe(false);
    expect(isOpaqueDynamicQueryKey(queryKey({ segments: ['todo', 'UNRESOLVED'] }))).toBe(false);
  });

  it('matches declared query keys based on relation and segments', () => {
    const declared = queryKey({ id: 'todo', display: 'todo', segments: ['todo'] });

    expect(actionAffectsDeclaredQueryKey(queryKey({ id: 'pass-through-query-key' }), declared)).toBe(false);
    expect(actionAffectsDeclaredQueryKey(queryKey({ source: 'wildcard' }), declared)).toBe(true);
    expect(actionAffectsDeclaredQueryKey(queryKey({ matchMode: 'all' }), declared)).toBe(true);
    expect(actionAffectsDeclaredQueryKey(queryKey({ matchMode: 'predicate' }), declared)).toBe(true);
    expect(actionAffectsDeclaredQueryKey(queryKey({ id: 'todo' }), declared)).toBe(true);
    expect(actionAffectsDeclaredQueryKey(queryKey({ display: 'todo', segments: ['todo'] }), declared)).toBe(true);
    expect(
      actionAffectsDeclaredQueryKey(
        queryKey({ display: 'todo', segments: ['todo', 'list'], matchMode: 'exact' }),
        declared,
      ),
    ).toBe(false);
    expect(actionAffectsDeclaredQueryKey(queryKey({ display: 'todo', segments: ['todo', 'list'] }), declared)).toBe(
      false,
    );
    expect(
      actionAffectsDeclaredQueryKey(
        queryKey({ display: 'dynamic', segments: ['todo', '$id'] }),
        queryKey({ display: 'dynamic', segments: ['todo', '1'] }),
      ),
    ).toBe(true);
    expect(
      actionAffectsDeclaredQueryKey(
        queryKey({ display: 'different', segments: ['todo', '$id'] }),
        queryKey({ display: 'dynamic', segments: ['todo', '1'] }),
      ),
    ).toBe(false);
    expect(
      actionAffectsDeclaredQueryKey(
        queryKey({ id: 'action-placeholder', segments: ['todo', '$id'] }),
        queryKey({ id: 'declared-placeholder', segments: ['todo', '1'] }),
      ),
    ).toBe(true);
    expect(
      actionAffectsDeclaredQueryKey(
        queryKey({ id: 'action-call', segments: ['todo', 'call(factory)'] }),
        queryKey({ id: 'declared-call', segments: ['todo', '1'] }),
      ),
    ).toBe(true);
    expect(
      actionAffectsDeclaredQueryKey(
        queryKey({ id: 'action-template', segments: ['todo', 'todo-' + '$' + '{id}'] }),
        queryKey({ id: 'declared-template', segments: ['todo', '1'] }),
      ),
    ).toBe(false);
    expect(
      actionAffectsDeclaredQueryKey(
        queryKey({ id: 'action-static-placeholder-declared', segments: ['todo', '1'] }),
        queryKey({ id: 'declared-placeholder', segments: ['todo', '$id'] }),
      ),
    ).toBe(false);
    expect(
      actionAffectsDeclaredQueryKey(
        queryKey({ id: 'action-static-dynamic-declared', segments: ['todo', '1'] }),
        queryKey({ id: 'declared-call', segments: ['todo', 'call(factory)'] }),
      ),
    ).toBe(true);
    expect(
      actionAffectsDeclaredQueryKey(
        queryKey({ id: 'action-unresolved-value', segments: ['todo', 'UNRESOLVED_VALUE'] }),
        queryKey({ id: 'declared-unresolved-value', segments: ['todo', '1'] }),
      ),
    ).toBe(true);
    expect(
      actionAffectsDeclaredQueryKey(
        queryKey({ id: 'action-empty', display: 'empty', segments: [''] }),
        queryKey({ id: 'declared-empty', display: 'todo', segments: ['todo'] }),
      ),
    ).toBe(false);
  });

  it('identifies set-anchored concrete keys', () => {
    expect(isSetAnchoredConcreteKey(queryKey({ source: 'wildcard' }))).toBe(false);
    expect(isSetAnchoredConcreteKey(queryKey({ id: 'pass-through-query-key' }))).toBe(false);
    expect(isSetAnchoredConcreteKey(queryKey({ id: 'all-query-cache' }))).toBe(false);
    expect(isSetAnchoredConcreteKey(queryKey({ id: 'unresolved_query_key' }))).toBe(false);
    expect(isSetAnchoredConcreteKey(queryKey({ id: 'todo' }))).toBe(true);
  });

  it('covers placeholder action segment matching', () => {
    const declared = queryKey({ id: 'declared-placeholder', display: '[todo, 1]', segments: ['todo', '1'] });
    const action = queryKey({ id: 'action-placeholder', display: '[todo, $id]', segments: ['todo', '$id'] });
    const originalSome = Array.prototype.some;
    vi.spyOn(Array.prototype, 'some').mockImplementation(function (
      this: unknown[],
      callback: Parameters<typeof originalSome>[0],
      thisArg?: Parameters<typeof originalSome>[1],
    ) {
      if (Array.isArray(this) && this.length === 2 && this[0] === 'todo' && this[1] === '$id') {
        return false;
      }
      return originalSome.call(this, callback, thisArg);
    });

    expect(actionAffectsDeclaredQueryKey(action, declared)).toBe(true);
  });

  it('treats exact matches as declarations and rejects non-placeholder arrays', () => {
    expect(
      isDeclarationAnchorRecord(
        createQueryRecord({
          relation: 'declares',
          operation: 'x',
          file: 'src/file.ts',
          loc: { line: 1, column: 1 },
          queryKey: queryKey({ segments: ['todo'] }),
        }),
      ),
    ).toBe(true);
    expect(isPlaceholderOnlyQueryKey(queryKey({ segments: ['todo', 'items'] }))).toBe(false);
    expect(isPlaceholderOnlyQueryKey(queryKey({ segments: ['   ', 'null', 'undefined'] }))).toBe(false);
    expect(isPlaceholderOnlyQueryKey(queryKey({ segments: ['null', 'undefined'] }))).toBe(true);
    expect(isOpaqueDynamicQueryKey(queryKey({ segments: ['todo', 'items', 'more'] }))).toBe(false);
    expect(isOpaqueDynamicQueryKey(queryKey({ segments: ['   ', '$id'] }))).toBe(true);
    expect(isOpaqueDynamicQueryKey(queryKey({ segments: ['call(factory)'] }))).toBe(true);
    expect(
      isWildcardQueryKey(
        createQueryRecord({
          relation: 'declares',
          operation: 'x',
          file: 'src/file.ts',
          loc: { line: 1, column: 1 },
          queryKey: queryKey({}),
        }),
      ),
    ).toBe(false);
  });
});
