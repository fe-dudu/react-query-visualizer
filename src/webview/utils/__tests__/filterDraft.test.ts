import { describe, expect, it } from 'vitest';

import {
  applyFilterDraft,
  buildFilterDraft,
  hasPendingFilterChanges,
  hasPendingOperationChanges,
  hasPendingTextFilterChanges,
} from '../filterDraft';

describe('webview/utils/filterDraft', () => {
  const filters = {
    relation: {
      invalidates: true,
      sets: false,
      refetches: false,
      cancels: false,
      resets: false,
      removes: false,
      clears: false,
    },
    fileQuery: 'src',
    search: 'query',
  };

  it('builds and applies drafts', () => {
    const draft = buildFilterDraft(filters);
    expect(draft).toEqual(filters);
    expect(hasPendingFilterChanges(filters, draft)).toBe(false);
    expect(hasPendingOperationChanges(filters, draft)).toBe(false);
    expect(hasPendingTextFilterChanges(filters, draft)).toBe(false);

    const nextDraft = {
      ...draft,
      relation: { ...draft.relation, sets: true },
      fileQuery: 'src/app',
    };
    expect(hasPendingFilterChanges(filters, nextDraft)).toBe(true);
    expect(hasPendingOperationChanges(filters, nextDraft)).toBe(true);
    expect(hasPendingTextFilterChanges(filters, nextDraft)).toBe(true);
    expect(applyFilterDraft(filters, nextDraft)).toEqual({
      ...filters,
      relation: { ...nextDraft.relation },
      fileQuery: 'src/app',
      search: 'query',
    });
  });
});
