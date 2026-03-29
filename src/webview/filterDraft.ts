import type { FilterState } from './viewTypes';

export interface FilterDraft {
  relation: FilterState['relation'];
  fileQuery: string;
  search: string;
}

export function buildFilterDraft(filters: FilterState): FilterDraft {
  return {
    relation: { ...filters.relation },
    fileQuery: filters.fileQuery,
    search: filters.search,
  };
}

export function hasPendingFilterChanges(filters: FilterState, draft: FilterDraft): boolean {
  return hasPendingOperationChanges(filters, draft) || hasPendingTextFilterChanges(filters, draft);
}

export function hasPendingOperationChanges(filters: FilterState, draft: FilterDraft): boolean {
  return Object.entries(filters.relation).some(
    ([relation, enabled]) => draft.relation[relation as keyof FilterState['relation']] !== enabled,
  );
}

export function hasPendingTextFilterChanges(filters: FilterState, draft: FilterDraft): boolean {
  if (filters.fileQuery !== draft.fileQuery || filters.search !== draft.search) {
    return true;
  }

  return false;
}

export function applyFilterDraft(filters: FilterState, draft: FilterDraft): FilterState {
  return {
    ...filters,
    relation: { ...draft.relation },
    fileQuery: draft.fileQuery,
    search: draft.search,
  };
}
