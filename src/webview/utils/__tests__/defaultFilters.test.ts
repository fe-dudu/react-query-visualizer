import { describe, expect, it } from 'vitest';

import { defaultFilters } from '../defaultFilters';

describe('webview/utils/defaultFilters', () => {
  it('exports the expected filter defaults', () => {
    expect(defaultFilters).toEqual({
      relation: {
        invalidates: true,
        sets: true,
        refetches: false,
        cancels: false,
        resets: false,
        removes: false,
        clears: false,
      },
      fileQuery: '',
      search: '',
    });
  });
});
