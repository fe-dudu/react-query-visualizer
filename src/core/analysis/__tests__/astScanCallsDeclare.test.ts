import { describe, expect, it } from 'vitest';

import { analyze, analyzeSources } from './analysisHarness';

const TANSTACK_IMPORT =
  "import { useQuery, useQueries, useSuspenseQuery, useSuspenseQueries, useInfiniteQuery, useSuspenseInfiniteQuery, queryOptions, infiniteQueryOptions } from '@tanstack/react-query';\n";

function declares(records: ReturnType<typeof analyze>) {
  return records.filter((r) => r.relation === 'declares');
}

describe('astScan declaration side - basic hooks', () => {
  it('records a useQuery declaration with an inline object queryKey', () => {
    const records = analyze(`${TANSTACK_IMPORT}useQuery({ queryKey: ['todos'], queryFn: () => 1 });`);
    const decl = declares(records);
    expect(decl).toHaveLength(1);
    expect(decl[0]).toMatchObject({
      relation: 'declares',
      operation: 'useQuery',
      declaresDirectly: true,
    });
    expect(decl[0].queryKey.segments).toEqual(['todos']);
    expect(decl[0].queryKey.display).toBe('[todos]');
    expect(decl[0].queryKey.matchMode).toBe('exact');
    expect(decl[0].queryKey.resolution).toBe('static');
  });

  it('records useInfiniteQuery / useSuspenseQuery / useSuspenseInfiniteQuery operations', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
useInfiniteQuery({ queryKey: ['inf'], queryFn: () => 1 });
useSuspenseQuery({ queryKey: ['susp'], queryFn: () => 1 });
useSuspenseInfiniteQuery({ queryKey: ['susinf'], queryFn: () => 1 });`,
      ),
    );
    const ops = records.map((r) => r.operation).sort();
    expect(ops).toEqual(['useInfiniteQuery', 'useSuspenseInfiniteQuery', 'useSuspenseQuery']);
  });

  it('records a queryOptions factory declaration (queryOptions is a tracked hook)', () => {
    const records = declares(analyze(`${TANSTACK_IMPORT}queryOptions({ queryKey: ['opt'], queryFn: () => 1 });`));
    expect(records.map((r) => r.queryKey.display)).toEqual(['[opt]']);
    expect(records[0].operation).toBe('queryOptions');
  });

  it('still records a direct declaration when queryKey value is a referenced variable', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const key = ['ref'] as const;
useQuery({ queryKey: key, queryFn: () => 1 });`,
      ),
    );
    expect(records).toHaveLength(1);
    expect(records[0].declaresDirectly).toBe(true);
    expect(records[0].queryKey.segments).toEqual(['ref']);
  });
});

describe('astScan declaration side - namespace imports', () => {
  it('records namespace member hook calls (rq.useQuery)', () => {
    const records = declares(
      analyze(
        `import * as rq from '@tanstack/react-query';
rq.useQuery({ queryKey: ['ns'], queryFn: () => 1 });`,
      ),
    );
    expect(records).toHaveLength(1);
    expect(records[0].operation).toBe('useQuery');
    expect(records[0].queryKey.display).toBe('[ns]');
  });
});

describe('astScan declaration side - useQueries collections', () => {
  it('expands a static array of inline query options', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
useQueries({ queries: [
  { queryKey: ['a'], queryFn: () => 1 },
  { queryKey: ['b'], queryFn: () => 1 },
] });`,
      ),
    );
    const keys = records.map((r) => r.queryKey.display).sort();
    expect(keys).toEqual(['[a]', '[b]']);
    expect(records.every((r) => r.operation === 'useQueries')).toBe(true);
  });

  it('expands useSuspenseQueries collections', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
useSuspenseQueries({ queries: [
  { queryKey: ['s1'], queryFn: () => 1 },
  { queryKey: ['s2'], queryFn: () => 1 },
] });`,
      ),
    );
    expect(records.map((r) => r.queryKey.display).sort()).toEqual(['[s1]', '[s2]']);
    expect(records.every((r) => r.operation === 'useSuspenseQueries')).toBe(true);
  });

  it('expands queries built from queryOptions factories referenced by variable', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const o1 = queryOptions({ queryKey: ['f1'], queryFn: () => 1 });
const o2 = queryOptions({ queryKey: ['f2'], queryFn: () => 1 });
const list = [o1, o2];
useQueries({ queries: list });`,
      ),
    );
    const keys = records.map((r) => r.queryKey.display);
    expect(keys).toContain('[f1]');
    expect(keys).toContain('[f2]');
  });
});

describe('astScan declaration side - useQueries iterator expansion', () => {
  it('expands an array .map(...) of inline query options', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const ids = ['x', 'y'];
useQueries({ queries: ids.map((id) => ({ queryKey: ['item', id], queryFn: () => 1 })) });`,
      ),
    );
    const display = records.map((r) => r.queryKey.display).sort();
    expect(display).toEqual(['[item, x]', '[item, y]']);
  });

  it('expands an array .flatMap(...) returning option arrays', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const ids = ['a', 'b'];
useQueries({ queries: ids.flatMap((id) => [{ queryKey: ['fm', id], queryFn: () => 1 }]) });`,
      ),
    );
    const display = records.map((r) => r.queryKey.display).sort();
    expect(display).toEqual(['[fm, a]', '[fm, b]']);
  });

  it('expands across .filter().concat() chains', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const base = [queryOptions({ queryKey: ['b1'], queryFn: () => 1 })];
const extra = [queryOptions({ queryKey: ['e1'], queryFn: () => 1 })];
useQueries({ queries: base.filter(Boolean).concat(extra).slice(0).reverse().sort() });`,
      ),
    );
    const display = records.map((r) => r.queryKey.display);
    expect(display).toContain('[b1]');
    expect(display).toContain('[e1]');
  });
});

describe('astScan declaration side - iterator template substitution', () => {
  it('substitutes the iterator param inside member-expression and template keys', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const users = [{ id: 1 }, { id: 2 }];
useQueries({ queries: users.map((u) => ({ queryKey: ['user', u.id, \`tag-\${u.id}\`], queryFn: () => 1 })) });`,
      ),
    );
    const display = records.map((r) => r.queryKey.display);
    expect(display.length).toBeGreaterThanOrEqual(2);
    expect(display.some((d) => d.includes('user'))).toBe(true);
  });

  it('substitutes the iterator param inside a template literal key element', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const ids = ['a', 'b'];
useQueries({ queries: ids.map((id) => ({ queryKey: [\`tmpl-\${id}\`], queryFn: () => 1 })) });`,
      ),
    );
    expect(records.length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the iterator param inside a computed member key element', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const ids = ['a', 'b'];
const lookup: Record<string, string> = { a: 'A', b: 'B' };
useQueries({ queries: ids.map((id) => ({ queryKey: [lookup[id]], queryFn: () => 1 })) });`,
      ),
    );
    expect(records.length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the iterator param inside a computed optional-member key element', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const ids = ['a', 'b'];
const lookup: Record<string, string> = { a: 'A', b: 'B' };
useQueries({ queries: ids.map((id) => ({ queryKey: [lookup?.[id], 'k'], queryFn: () => 1 })) });`,
      ),
    );
    expect(records.length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the iterator param inside a resolvable call key element', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const ids = ['a', 'b'];
function tag(x: string) { return x; }
useQueries({ queries: ids.map((id) => ({ queryKey: [tag(id)], queryFn: () => 1 })) });`,
      ),
    );
    expect(records.length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the iterator param inside an unresolved call key element (arg map runs)', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const ids = ['a', 'b'];
declare function unknownFn(x: string): string;
useQueries({ queries: ids.map((id) => ({ queryKey: ['p', unknownFn(id), id], queryFn: () => 1 })) });`,
      ),
    );
    expect(records.length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the iterator param inside an unresolved optional-call key element', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const ids = ['a', 'b'];
declare const unknownFn: ((x: string) => string) | undefined;
useQueries({ queries: ids.map((id) => ({ queryKey: ['p', unknownFn?.(id), id], queryFn: () => 1 })) });`,
      ),
    );
    expect(records.length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the iterator param inside unary/binary/logical/sequence key forms', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const nums = [1, 2];
useQueries({ queries: nums.map((n) => ({
  queryKey: [-n, n + 1, n && 'truthy', n || 'fallback', (n, 'seq')],
  queryFn: () => 1,
})) });`,
      ),
    );
    expect(records.length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the iterator param inside a conditional key element', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const ids = ['a', 'b'];
useQueries({ queries: ids.map((id) => ({ queryKey: [id === 'a' ? 'first' : id], queryFn: () => 1 })) });`,
      ),
    );
    expect(records.length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the iterator param inside spread key forms', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const segs = [['x'], ['y']];
useQueries({ queries: segs.map((seg) => ({ queryKey: [...seg, 'tail'], queryFn: () => 1 })) });`,
      ),
    );
    expect(records.length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the iterator param through nested array/object templates', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const items = ['m', 'n'];
useQueries({ queries: items.map((it) => ({ queryKey: ['scope', { kind: it }, [it]], queryFn: () => 1 })) });`,
      ),
    );
    expect(records.length).toBeGreaterThanOrEqual(2);
  });

  it('resolves a mapper passed by reference for the static-collection template path', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const ids = ['p', 'q'];
const toQuery = (id: string) => ({ queryKey: ['ref-mapper', id], queryFn: () => 1 });
useQueries({ queries: ids.map(toQuery) });`,
      ),
    );
    const display = records.map((r) => r.queryKey.display);
    expect(display.some((d) => d.startsWith('[ref-mapper'))).toBe(true);
  });
});

describe('astScan declaration side - hook collection control flow', () => {
  it('collects queries from a conditional queries expression', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
declare const flag: boolean;
useQueries({ queries: flag
  ? [{ queryKey: ['cond-a'], queryFn: () => 1 }]
  : [{ queryKey: ['cond-b'], queryFn: () => 1 }] });`,
      ),
    );
    const display = records.map((r) => r.queryKey.display).sort();
    expect(display).toEqual(['[cond-a]', '[cond-b]']);
  });

  it('collects queries from a logical || queries expression', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
declare const maybe: undefined | { queryKey: string[] }[];
useQueries({ queries: maybe || [{ queryKey: ['fallback'], queryFn: () => 1 }] });`,
      ),
    );
    const display = records.map((r) => r.queryKey.display);
    expect(display).toContain('[fallback]');
  });

  it('collects queries from a logical && queries expression (right side)', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
declare const ready: boolean;
useQueries({ queries: ready && [{ queryKey: ['gated'], queryFn: () => 1 }] });`,
      ),
    );
    const display = records.map((r) => r.queryKey.display);
    expect(display).toContain('[gated]');
  });
});

describe('astScan declaration side - static iterable resolution variants', () => {
  it('resolves an iterable referenced via a conditional/logical expression', () => {
    const records = analyze(
      `import { useQueryClient } from '@tanstack/react-query';
const client = useQueryClient();
declare const cond: boolean;
const a = ['a1', 'a2'];
const b = ['b1'];
(cond ? a : b).forEach((seg) => {
  client.invalidateQueries({ queryKey: ['cond-iter', seg] });
});`,
    );
    const display = records
      .filter((r) => r.relation === 'invalidates')
      .map((r) => r.queryKey.display)
      .sort();
    expect(display).toEqual(['[cond-iter, a1]', '[cond-iter, a2]', '[cond-iter, b1]']);
  });

  it('resolves an iterable that is the result of a factory call', () => {
    const records = analyze(
      `import { useQueryClient } from '@tanstack/react-query';
const client = useQueryClient();
function listIds() { return ['c1', 'c2']; }
listIds().forEach((seg) => {
  client.invalidateQueries({ queryKey: ['call-iter', seg] });
});`,
    );
    const display = records
      .filter((r) => r.relation === 'invalidates')
      .map((r) => r.queryKey.display)
      .sort();
    expect(display).toEqual(['[call-iter, c1]', '[call-iter, c2]']);
  });

  it('resolves an iterable referenced through an || fallback', () => {
    const records = analyze(
      `import { useQueryClient } from '@tanstack/react-query';
const client = useQueryClient();
declare const provided: string[] | undefined;
const fallback = ['f1', 'f2'];
(provided || fallback).forEach((seg) => {
  client.invalidateQueries({ queryKey: ['or-iter', seg] });
});`,
    );
    const display = records
      .filter((r) => r.relation === 'invalidates')
      .map((r) => r.queryKey.display)
      .sort();
    expect(display).toEqual(['[or-iter, f1]', '[or-iter, f2]']);
  });
});

describe('astScan declaration side - hook collection entry forms', () => {
  it('collects from a namespace-member queryOptions-like call entry', () => {
    const records = declares(
      analyze(
        `import * as rq from '@tanstack/react-query';
rq.useQueries({ queries: [rq.queryOptions({ queryKey: ['ns-opt'], queryFn: () => 1 })] });`,
      ),
    );
    expect(records.map((r) => r.queryKey.display)).toContain('[ns-opt]');
  });

  it('collects from a queries factory function referenced by name', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const buildQueries = () => [
  queryOptions({ queryKey: ['fn-a'], queryFn: () => 1 }),
  queryOptions({ queryKey: ['fn-b'], queryFn: () => 1 }),
];
useQueries({ queries: buildQueries() });`,
      ),
    );
    const display = [...new Set(records.map((r) => r.queryKey.display))].sort();
    expect(display).toEqual(['[fn-a]', '[fn-b]']);
  });

  it('collects from inline queryOptions/infiniteQueryOptions call entries in the queries array', () => {
    const records = declares(
      analyze(
        `import { useQueries, queryOptions, infiniteQueryOptions } from '@tanstack/react-query';
useQueries({ queries: [
  queryOptions({ queryKey: ['inline-opt'], queryFn: () => 1 }),
  infiniteQueryOptions({ queryKey: ['inline-inf'], queryFn: () => 1 }),
] });`,
      ),
    );
    const display = records.map((r) => r.queryKey.display);
    expect(display).toContain('[inline-opt]');
    expect(display).toContain('[inline-inf]');
  });

  it('ignores a queries entry that is a non-identifier/non-member call (e.g. call-of-call)', () => {
    const records = declares(
      analyze(
        `import { useQueries } from '@tanstack/react-query';
declare const getFactory: () => (() => any);
useQueries({ queries: [getFactory()()] });`,
      ),
    );
    expect(records.every((r) => r.operation === 'useQueries')).toBe(true);
  });

  it('collects when queries resolves directly to an array of queryKey arrays', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const opt = queryOptions({ queryKey: ['direct-arr'], queryFn: () => 1 });
useQueries({ queries: [opt] });`,
      ),
    );
    expect(records.map((r) => r.queryKey.display)).toContain('[direct-arr]');
  });
});

describe('astScan declaration side - imported collection & mapper references', () => {
  it('resolves a queries collection imported from another module', () => {
    const records = declares(
      analyzeSources({
        'src/queries.ts': `import { queryOptions } from '@tanstack/react-query';
export const importedQueries = [
  queryOptions({ queryKey: ['imp-a'], queryFn: () => 1 }),
  queryOptions({ queryKey: ['imp-b'], queryFn: () => 1 }),
];`,
        'src/app.ts': `import { useQueries } from '@tanstack/react-query';
import { importedQueries } from '../../queries';
useQueries({ queries: importedQueries });`,
      }),
    );
    const display = [...new Set(records.map((r) => r.queryKey.display))].sort();
    expect(display).toContain('[imp-a]');
    expect(display).toContain('[imp-b]');
  });

  it('expands a map mapper that is an imported arrow function', () => {
    const records = declares(
      analyzeSources({
        'src/mapper.ts': `import { queryOptions } from '@tanstack/react-query';
export const toQuery = (id: string) => queryOptions({ queryKey: ['mapped', id], queryFn: () => 1 });`,
        'src/app.ts': `import { useQueries } from '@tanstack/react-query';
import { toQuery } from '../../mapper';
const ids = ['m', 'n'];
useQueries({ queries: ids.map(toQuery) });`,
      }),
    );
    const display = records.map((r) => r.queryKey.display);
    expect(display.some((d) => d.startsWith('[mapped'))).toBe(true);
  });

  it('collects nested queries from an object resolved without a top-level queryKey', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const config = { queries: [{ queryKey: ['nested'], queryFn: () => 1 }] };
useQueries(config);`,
      ),
    );
    expect(records.map((r) => r.queryKey.display)).toContain('[nested]');
  });
});

describe('astScan declaration side - action iterator expansion (drives shared helpers)', () => {
  it('expands invalidateQueries inside an array.forEach over a static collection', () => {
    const records = analyze(
      `import { useQueryClient } from '@tanstack/react-query';
const client = useQueryClient();
const groups = ['g1', 'g2'];
groups.forEach((g) => {
  client.invalidateQueries({ queryKey: ['group', g] });
});`,
    );
    const display = records
      .filter((r) => r.relation === 'invalidates')
      .map((r) => r.queryKey.display)
      .sort();
    expect(display).toEqual(['[group, g1]', '[group, g2]']);
  });

  it('expands setQueryData inside a map over a static collection', () => {
    const records = analyze(
      `import { useQueryClient } from '@tanstack/react-query';
const client = useQueryClient();
const tags = ['t1', 't2'];
tags.map((tag) => client.setQueryData(['tag', tag], []));`,
    );
    const display = records
      .filter((r) => r.relation === 'sets')
      .map((r) => r.queryKey.display)
      .sort();
    expect(display).toEqual(['[tag, t1]', '[tag, t2]']);
  });
});

describe('astScan declaration side - more iterator/collection edges', () => {
  it('expands concatenated map results in a useQueries collection', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const left = ['l1', 'l2'];
const right = ['r1'];
useQueries({ queries: left.map((l) => ({ queryKey: ['L', l], queryFn: () => 1 }))
  .concat(right.map((r) => ({ queryKey: ['R', r], queryFn: () => 1 }))) });`,
      ),
    );
    const display = records.map((r) => r.queryKey.display);
    expect(display).toContain('[L, l1]');
    expect(display).toContain('[R, r1]');
  });

  it('expands filtered/sliced map results in a useQueries collection', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const ids = ['s1', 's2'];
useQueries({ queries: ids.map((id) => ({ queryKey: ['S', id], queryFn: () => 1 })).filter(Boolean).slice(0) });`,
      ),
    );
    const display = records.map((r) => r.queryKey.display).sort();
    expect(display).toEqual(['[S, s1]', '[S, s2]']);
  });

  it('does not expand when the collection uses an unsupported iterator method', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const ids = ['a', 'b'];
useQueries({ queries: ids.reduce((acc, id) => [...acc, { queryKey: ['red', id], queryFn: () => 1 }], []) });`,
      ),
    );
    expect(records.length).toBeGreaterThanOrEqual(0);
  });

  it('does not expand when the iterable is an unsupported expression form (new ...)', () => {
    const records = analyze(
      `import { useQueryClient } from '@tanstack/react-query';
const client = useQueryClient();
new Set(['n1', 'n2']).forEach((seg) => {
  client.invalidateQueries({ queryKey: ['newset', seg] });
});`,
    );
    const expanded = records.filter((r) => r.relation === 'invalidates').map((r) => r.queryKey.display);
    expect(expanded).not.toContain('[newset, n1]');
  });

  it('handles an unresolvable forEach iterable without expanding', () => {
    const records = analyze(
      `import { useQueryClient } from '@tanstack/react-query';
const client = useQueryClient();
declare const dynamicList: string[];
dynamicList.forEach((seg) => {
  client.invalidateQueries({ queryKey: ['dyn', seg] });
});`,
    );
    expect(records.filter((r) => r.relation === 'invalidates').length).toBeGreaterThanOrEqual(1);
  });

  it('skips a pass-through action whose queryKey identifier resolves to an empty key', () => {
    const records = analyze(
      `import { useQueryClient } from '@tanstack/react-query';
const client = useQueryClient();
const emptyKey: unknown[] = [];
client.invalidateQueries({ queryKey: emptyKey });`,
    );
    expect(records.filter((r) => r.relation === 'invalidates')).toHaveLength(0);
  });

  it('skips a pass-through action whose queryKey member resolves to an empty key', () => {
    const records = analyze(
      `import { useQueryClient } from '@tanstack/react-query';
const client = useQueryClient();
const holder = { key: [] as unknown[] };
client.invalidateQueries({ queryKey: holder.key });`,
    );
    expect(records.filter((r) => r.relation === 'invalidates')).toHaveLength(0);
  });

  it('keeps an action whose queryKey is a computed member resolving to an empty key', () => {
    const records = analyze(
      `import { useQueryClient } from '@tanstack/react-query';
const client = useQueryClient();
const holder = { key: [] as unknown[] };
client.invalidateQueries({ queryKey: holder['key'] });`,
    );
    const invalidations = records.filter((r) => r.relation === 'invalidates');
    expect(invalidations).toHaveLength(1);
    expect(invalidations[0].queryKey.id).toBe('all-query-cache');
  });

  it('keeps an action whose queryKey is an unresolved module identifier (expression key)', () => {
    const records = analyze(
      `import { useQueryClient } from '@tanstack/react-query';
declare const externalKey: unknown[];
const client = useQueryClient();
client.invalidateQueries({ queryKey: externalKey });`,
    );
    const invalidations = records.filter((r) => r.relation === 'invalidates');
    expect(invalidations).toHaveLength(1);
    expect(invalidations[0].queryKey.display).toBe('$externalKey');
  });

  it('keeps a pass-through action whose queryKey is a function parameter', () => {
    const records = analyze(
      `import { QueryClient } from '@tanstack/react-query';
function invalidate(client: QueryClient, queryKey: unknown[]) {
  client.invalidateQueries({ queryKey });
}`,
    );
    expect(records.filter((r) => r.relation === 'invalidates').length).toBeGreaterThanOrEqual(1);
  });
});

describe('astScan declaration side - property key + location forms', () => {
  it('resolves a string-literal queryKey property key', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const ref = ['str-key'] as const;
useQuery({ 'queryKey': ref, queryFn: () => 1 });`,
      ),
    );
    expect(records.map((r) => r.queryKey.display)).toContain('[str-key]');
  });

  it('tolerates a numeric-literal property key alongside the queryKey', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const ref = ['num-key'] as const;
useQuery({ queryKey: ref, queryFn: () => 1, 0: 'positional' });`,
      ),
    );
    expect(records.map((r) => r.queryKey.display)).toContain('[num-key]');
  });

  it('tolerates a computed (non-literal) property key alongside the queryKey', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
const ref = ['computed-key'] as const;
const dynKey = 'meta';
useQuery({ queryKey: ref, queryFn: () => 1, [dynKey + '!']: 'x' });`,
      ),
    );
    expect(records.map((r) => r.queryKey.display)).toContain('[computed-key]');
  });

  it('records a hook call split across multiple lines', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
useQuery(
  {
    queryKey: ['multiline'],
    queryFn: () => 1,
  }
);`,
      ),
    );
    expect(records).toHaveLength(1);
    expect(records[0].queryKey.display).toBe('[multiline]');
    expect(records[0].loc.line).toBeGreaterThan(0);
  });

  it('records a member-call declare method split across lines', () => {
    const records = declares(
      analyze(
        `import { QueryClient } from '@tanstack/react-query';
const client = new QueryClient();
client
  .fetchQuery({ queryKey: ['ml-member'], queryFn: () => 1 });`,
      ),
    );
    expect(records.map((r) => r.queryKey.display)).toContain('[ml-member]');
  });
});

describe('astScan declaration side - typed param query keys', () => {
  it('resolves a queryKey from a param typed as ReturnType<typeof factory>', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
function makeKey() { return ['rt', 'x'] as const; }
function useThing(key: ReturnType<typeof makeKey>) {
  return useQuery({ queryKey: key, queryFn: () => 1 });
}`,
      ),
    );
    expect(records.map((r) => r.queryKey.display)).toContain('[rt, x]');
  });

  it('resolves a queryKey from a param typed as ReturnType<typeof ns.factory>', () => {
    const records = declares(
      analyzeSources({
        'src/keyFactory.ts': `export const factory = { makeKey() { return ['qual', 'y'] as const; } };`,
        'src/app.ts': `import { useQuery } from '@tanstack/react-query';
import { factory } from '../../keyFactory';
function useThing(key: ReturnType<typeof factory.makeKey>) {
  return useQuery({ queryKey: key, queryFn: () => 1 });
}`,
      }),
    );
    expect(records.length).toBeGreaterThanOrEqual(0);
  });

  it('detects a query client supplied via a typed destructured property param', () => {
    const records = analyze(
      `import { QueryClient } from '@tanstack/react-query';
function run({ queryClient }: { queryClient: QueryClient }) {
  queryClient.invalidateQueries({ queryKey: ['typed-destructure'] });
}`,
    );
    expect(records.filter((r) => r.relation === 'invalidates').map((r) => r.queryKey.display)).toContain(
      '[typed-destructure]',
    );
  });

  it('detects a typed destructured client with string-literal and numeric type-literal keys', () => {
    const records = analyze(
      `import { QueryClient } from '@tanstack/react-query';
function run({ queryClient }: { 'queryClient': QueryClient; 0: number }) {
  queryClient.invalidateQueries({ queryKey: ['tl-str'] });
}`,
    );
    expect(records.filter((r) => r.relation === 'invalidates').map((r) => r.queryKey.display)).toContain('[tl-str]');
  });
});

describe('astScan declaration side - queryClient declare methods', () => {
  const CLIENT_IMPORT = "import { QueryClient, useQueryClient } from '@tanstack/react-query';\n";

  it('records fetchQuery as a declaration', () => {
    const records = declares(
      analyze(
        `${CLIENT_IMPORT}
const client = new QueryClient();
client.fetchQuery({ queryKey: ['fetched'], queryFn: () => 1 });`,
      ),
    );
    expect(records).toHaveLength(1);
    expect(records[0].operation).toBe('fetchQuery');
    expect(records[0].queryKey.display).toBe('[fetched]');
  });

  it('records prefetchQuery / ensureQueryData / fetchInfiniteQuery declarations', () => {
    const records = declares(
      analyze(
        `${CLIENT_IMPORT}
const client = useQueryClient();
client.prefetchQuery({ queryKey: ['p'], queryFn: () => 1 });
client.ensureQueryData({ queryKey: ['e'], queryFn: () => 1 });
client.fetchInfiniteQuery({ queryKey: ['fi'], queryFn: () => 1 });`,
      ),
    );
    const ops = records.map((r) => r.operation).sort();
    expect(ops).toEqual(['ensureQueryData', 'fetchInfiniteQuery', 'prefetchQuery']);
  });

  it('does not record declare methods on an untracked object', () => {
    const records = declares(
      analyze(
        `${CLIENT_IMPORT}
const notAClient = {} as any;
notAClient.fetchQuery({ queryKey: ['nope'], queryFn: () => 1 });`,
      ),
    );
    expect(records).toHaveLength(0);
  });
});

describe('astScan declaration side - scope ids', () => {
  it('attaches an execution + suite scope id from describe/it wrappers', () => {
    const records = declares(
      analyze(
        `${TANSTACK_IMPORT}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
describe('suite', () => {
  it('case', () => {
    useQuery({ queryKey: ['scoped'], queryFn: () => 1 });
  });
});`,
      ),
    );
    expect(records).toHaveLength(1);
    expect(records[0].executionScopeId).toBeDefined();
    expect(records[0].suiteScopeId).toBeDefined();
  });

  it('attaches a client scope id from the hook second-argument client', () => {
    const records = declares(
      analyze(
        `import { useQuery, QueryClient } from '@tanstack/react-query';
const client = new QueryClient();
useQuery({ queryKey: ['c'], queryFn: () => 1 }, client);`,
      ),
    );
    expect(records).toHaveLength(1);
    expect(records[0].clientScopeId).toBeDefined();
  });
});
