import { describe, expect, it } from 'vitest';

import { analyze, analyzeSources } from './analysisHarness';

describe('core/analysis/astScan', () => {
  it('scans a rich multi-file workspace end to end', () => {
    const records = analyzeSources({
      'src/support.ts': [
        "export const todoKey = ['todos'] as const;",
        'export function makeTodoKey(id: string) {',
        "  return ['todo', id] as const;",
        '}',
        'export default function defaultFactory() { return todoKey; }',
      ].join('\n'),
      'src/app.ts': [
        "import * as rq from '@tanstack/react-query';",
        "import { infiniteQueryOptions, queryOptions, useQueries, useQuery, useQueryClient, useSuspenseQueries } from '@tanstack/react-query';",
        'const queryClient = useQueryClient();',
        "const localKey = ['todos'] as const;",
        "const secondaryKey = ['users'] as const;",
        'const options = queryOptions({',
        '  queryKey: localKey,',
        "  queryFn: () => Promise.resolve('ok'),",
        '});',
        'const queries = [options, queryOptions({ queryKey: secondaryKey, queryFn: () => null })];',
        'const queryResult = useQuery(options);',
        'const queryResults = useQueries({ queries });',
        'const suspenseResults = useSuspenseQueries({ queries });',
        'queryClient.invalidateQueries({ queryKey: localKey, exact: true });',
        "queryClient.invalidateQueries({ predicate: (entry) => entry.queryKey[0] === 'todos' });",
        'queryClient.refetchQueries({ queryKey: localKey });',
        'queryClient.getQueriesData({ queryKey: localKey });',
        'queryClient.getQueriesData(localKey);',
        'queryClient.removeQueries({ queryKey: localKey });',
        'queryClient.setQueryData(localKey, []);',
        'queryClient.clear();',
        'export { queryResult, queryResults, suspenseResults };',
      ].join('\n'),
    });

    expect(records.length).toBeGreaterThan(0);
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
    expect(records.some((r) => r.relation === 'declares')).toBe(true);
  });

  it('handles a file with no query usage', () => {
    const records = analyze('export const x = 1;\nconsole.log(x);');
    expect(records).toEqual([]);
  });
});
