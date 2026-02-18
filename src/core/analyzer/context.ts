import type { ParseContext } from './types';
import type { Resolution } from '../../types';

export function createParseContext(): ParseContext {
  return {
    queryHooks: new Map(),
    queryHookKinds: new Map(),
    queryNamespaces: new Map(),
    useQueryClientNames: new Map(),
    queryClientCtorNames: new Map(),
    queryClientTypeNames: new Map(),
    queryClientVars: new Map(),
    refetchFnNames: new Set(),
    refetchObjectNames: new Set(),
    refetchFnQueryKeys: new Map(),
    refetchObjectQueryKeys: new Map(),
  };
}

export function setCertainty(map: Map<string, Resolution>, key: string, certainty: Resolution): void {
  const current = map.get(key);
  if (current === 'static') {
    return;
  }

  if (!current || certainty === 'static') {
    map.set(key, certainty);
  }
}

export function getCertainty(map: Map<string, Resolution>, key: string): Resolution | undefined {
  return map.get(key);
}

export function mergeResolution(a: Resolution, b: Resolution): Resolution {
  return a === 'dynamic' || b === 'dynamic' ? 'dynamic' : 'static';
}

export function isQueryLikeModule(source: string): boolean {
  return source.includes('react-query') || source.includes('tanstack') || /(^|[/-])query([/-]|$)/.test(source);
}
