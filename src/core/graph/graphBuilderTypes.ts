import type { QueryRecord } from '../../shared/types';

export interface GraphRoot {
  name: string;
  path: string;
}

export interface PendingActionToQueryLink {
  actionNodeId: string;
  operation: string;
  relation: QueryRecord['relation'];
  resolution: QueryRecord['resolution'];
  file: string;
  projectScope: string;
  clientScopeId?: string;
  executionScopeId?: string;
  suiteScopeId?: string;
  queryKey: QueryRecord['queryKey'];
  wildcard: boolean;
  queryKeyNodeId?: string;
}
