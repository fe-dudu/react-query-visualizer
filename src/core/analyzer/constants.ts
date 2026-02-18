import type { ParserPlugin } from '@babel/parser';

import type { QueryRecord } from '../../types';

export const QUERY_HOOKS = new Set([
  'useQuery',
  'useInfiniteQuery',
  'useSuspenseQuery',
  'useSuspenseInfiniteQuery',
  'useQueries',
  'useSuspenseQueries',
  'queryOptions',
  'usePrefetchQuery',
  'usePrefetchInfiniteQuery',
]);

export const QUERY_CLIENT_DECLARE_METHODS = new Set([
  'fetchQuery',
  'prefetchQuery',
  'ensureQueryData',
  'fetchInfiniteQuery',
  'prefetchInfiniteQuery',
  'ensureInfiniteQueryData',
]);

export const ACTION_METHOD_TO_RELATION = new Map<string, QueryRecord['relation']>([
  ['invalidateQueries', 'invalidates'],
  ['refetchQueries', 'refetches'],
  ['cancelQueries', 'cancels'],
  ['resetQueries', 'resets'],
  ['clear', 'clears'],
  ['removeQueries', 'removes'],
  ['setQueryData', 'sets'],
  ['setQueriesData', 'sets'],
]);

export const PARSER_TS_PLUGINS: ParserPlugin[] = [
  'typescript',
  'jsx',
  'classProperties',
  'objectRestSpread',
  'decorators-legacy',
  'optionalChaining',
  'nullishCoalescingOperator',
  'dynamicImport',
];

export const PARSER_FLOW_PLUGINS: ParserPlugin[] = [
  'flow',
  'flowComments',
  'jsx',
  'classProperties',
  'objectRestSpread',
  'decorators-legacy',
  'optionalChaining',
  'nullishCoalescingOperator',
  'dynamicImport',
];
