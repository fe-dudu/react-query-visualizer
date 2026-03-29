import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyFilterDraft,
  buildFilterDraft,
  hasPendingFilterChanges,
  hasPendingOperationChanges,
  hasPendingTextFilterChanges,
} from '../src/webview/filterDraft';
import type { FilterState } from '../src/webview/viewTypes';

function makeFilters(): FilterState {
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
    fileQuery: 'packages/a',
    search: 'todos',
  };
}

test('hasPendingFilterChanges detects draft edits', () => {
  const filters = makeFilters();
  const draft = buildFilterDraft(filters);

  assert.equal(hasPendingFilterChanges(filters, draft), false);
  assert.equal(hasPendingFilterChanges(filters, { ...draft, fileQuery: 'packages/b' }), true);
  assert.equal(hasPendingFilterChanges(filters, { ...draft, search: 'posts' }), true);
  assert.equal(hasPendingTextFilterChanges(filters, { ...draft, search: 'posts' }), true);
  assert.equal(
    hasPendingFilterChanges(filters, {
      ...draft,
      relation: {
        ...draft.relation,
        invalidates: false,
      },
    }),
    true,
  );
  assert.equal(
    hasPendingOperationChanges(filters, {
      ...draft,
      relation: {
        ...draft.relation,
        invalidates: false,
      },
    }),
    true,
  );
});

test('applyFilterDraft updates deferred text and operation filters', () => {
  const filters = makeFilters();
  const next = applyFilterDraft(filters, {
    relation: {
      ...filters.relation,
      invalidates: false,
      sets: true,
    },
    fileQuery: 'packages/core',
    search: 'user',
  });

  assert.deepEqual(next.relation, {
    ...filters.relation,
    invalidates: false,
    sets: true,
  });
  assert.equal(next.fileQuery, 'packages/core');
  assert.equal(next.search, 'user');
});
