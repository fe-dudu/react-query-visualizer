import type { FilterState } from '../types/viewTypes';

export const defaultFilters: FilterState = {
  relation: {
    invalidates: false,
    refetches: false,
    cancels: false,
    resets: false,
    removes: false,
    sets: false,
    clears: false,
  },
  fileQuery: '',
  search: '',
};
