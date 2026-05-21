import type { QueryRecord } from '../../shared/types';

export function isWildcardQueryKey(record: QueryRecord): boolean {
  if (record.queryKey.source === 'wildcard') {
    return true;
  }

  if (record.queryKey.id === '*' || record.queryKey.id === 'all-query-cache') {
    return true;
  }

  return false;
}

export function isDeclarationAnchorRecord(record: Pick<QueryRecord, 'relation' | 'operation' | 'queryKey'>): boolean {
  return record.relation === 'declares';
}

function normalizeComparableSegments(key: QueryRecord['queryKey']): string[] {
  return key.segments.filter((segment) => segment.length > 0 && segment !== 'UNRESOLVED');
}

function isDynamicSegment(segment: string): boolean {
  const normalized = segment.trim();
  if (!normalized) {
    return true;
  }

  if (normalized === 'UNRESOLVED') {
    return true;
  }

  if (normalized.startsWith('$')) {
    return true;
  }

  if (normalized.includes('UNRESOLVED')) {
    return true;
  }

  if (normalized.startsWith('call(') || normalized.startsWith('cond(')) {
    return true;
  }

  return false;
}

function isPlaceholderSegment(segment: string): boolean {
  const normalized = segment.trim();
  return normalized.startsWith('$') || normalized === 'UNRESOLVED';
}

function isTemplateDynamicSegment(segment: string): boolean {
  return segment.includes('${');
}

function actionSegmentMatchesDeclaredSegment(actionSegment: string, declaredSegment: string): boolean {
  if (actionSegment === declaredSegment) {
    return true;
  }

  const actionIsTemplate = isTemplateDynamicSegment(actionSegment);
  const declaredIsTemplate = isTemplateDynamicSegment(declaredSegment);
  if (actionIsTemplate || declaredIsTemplate) {
    return false;
  }

  if (isPlaceholderSegment(actionSegment)) {
    return true;
  }

  if (isPlaceholderSegment(declaredSegment)) {
    return false;
  }

  if (isDynamicSegment(actionSegment) || isDynamicSegment(declaredSegment)) {
    return true;
  }

  return false;
}

function actionHasPrefixSegments(prefix: string[], declaredValue: string[]): boolean {
  if (prefix.length > declaredValue.length) {
    return false;
  }

  for (let index = 0; index < prefix.length; index += 1) {
    if (!actionSegmentMatchesDeclaredSegment(prefix[index], declaredValue[index])) {
      return false;
    }
  }

  return true;
}

export function actionAffectsDeclaredQueryKey(
  actionQueryKey: QueryRecord['queryKey'],
  declaredQueryKey: QueryRecord['queryKey'],
): boolean {
  // `invalidateQueries({ queryKey })` pass-through cannot be safely expanded.
  // Keep it as its own dynamic key node instead of matching every declared key.
  if (actionQueryKey.id === 'pass-through-query-key') {
    return false;
  }

  if (
    actionQueryKey.source === 'wildcard' ||
    actionQueryKey.matchMode === 'all' ||
    actionQueryKey.matchMode === 'predicate'
  ) {
    return true;
  }

  if (actionQueryKey.id === declaredQueryKey.id) {
    return true;
  }

  const actionSegments = normalizeComparableSegments(actionQueryKey);
  const declaredSegments = normalizeComparableSegments(declaredQueryKey);
  if (actionSegments.length === 0 || declaredSegments.length === 0) {
    return false;
  }

  if (actionQueryKey.matchMode === 'exact') {
    return (
      actionSegments.length === declaredSegments.length && actionHasPrefixSegments(actionSegments, declaredSegments)
    );
  }

  return actionHasPrefixSegments(actionSegments, declaredSegments);
}

export function isSetAnchoredConcreteKey(queryKey: QueryRecord['queryKey']): boolean {
  if (queryKey.source === 'wildcard') {
    return false;
  }

  if (
    queryKey.id === 'pass-through-query-key' ||
    queryKey.id === 'all-query-cache' ||
    queryKey.id === 'unresolved_query_key'
  ) {
    return false;
  }

  return true;
}
