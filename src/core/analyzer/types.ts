import type * as t from '@babel/types';

import type { NormalizedQueryKey, Resolution } from '../../types';

export interface ParseContext {
  queryHooks: Map<string, Resolution>;
  queryHookKinds: Map<string, string>;
  queryNamespaces: Map<string, Resolution>;
  useQueryClientNames: Map<string, Resolution>;
  queryClientCtorNames: Map<string, Resolution>;
  queryClientTypeNames: Map<string, Resolution>;
  queryClientVars: Map<string, Resolution>;
  refetchFnNames: Set<string>;
  refetchObjectNames: Set<string>;
  refetchFnQueryKeys: Map<string, NormalizedQueryKey>;
  refetchObjectQueryKeys: Map<string, NormalizedQueryKey>;
}

export interface SegmentResult {
  text: string;
  isStatic: boolean;
}

export interface ImportBinding {
  kind: 'named' | 'default' | 'namespace';
  source: string;
  imported?: string;
}

export interface ReExportBinding {
  source: string;
  imported?: string;
  exported?: string;
  all: boolean;
}

export interface FileSymbols {
  filePath: string;
  values: Map<string, t.Expression>;
  functions: Map<string, t.Expression>;
  imports: Map<string, ImportBinding>;
  exports: Map<string, string>;
  reExports: ReExportBinding[];
}

export interface SymbolIndex {
  files: Map<string, FileSymbols>;
  fileSet: Set<string>;
}

export interface QueryKeyResolver {
  resolveReference(node: t.Expression): t.Expression | undefined;
  resolveCallResult(callee: t.CallExpression['callee']): t.Expression | undefined;
}
