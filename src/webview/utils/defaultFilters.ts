import type { FilterState } from '../types/viewTypes';

export const defaultFilters: FilterState = {
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
};
