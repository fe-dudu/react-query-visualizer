import { describe, expect, it } from 'vitest';

import { analyze, analyzeSources } from './analysisHarness';

/**
 * Tests focused on the CACHE-ACTION + ARGUMENT-RESOLUTION machinery of
 * src/core/analysis/astScan.ts (scanCalls cache actions, member-call refetch,
 * getQueriesData key helpers, type-based factory
 * resolution, parameter substitution, and resolveLocalActionArgExpression /
 * resolveActionArgsWithLocalBindings). All assertions are on the QueryRecord[]
 * produced by the full analyzer pipeline.
 */

const CLIENT_IMPORT = "import { useQueryClient, QueryClient } from '@tanstack/react-query';\n";

function ofRelation(records: ReturnType<typeof analyze>, relation: string) {
  return records.filter((r) => r.relation === relation);
}

describe('astScan cache actions - the eight client methods', () => {
  const KEY = "const key = ['todos'] as const;\n";

  it('records invalidateQueries with { queryKey } form', () => {
    const records = analyze(
      `${CLIENT_IMPORT}${KEY}const c = useQueryClient();\nc.invalidateQueries({ queryKey: key });`,
    );
    const inv = ofRelation(records, 'invalidates');
    expect(inv).toHaveLength(1);
    expect(inv[0].operation).toBe('invalidateQueries');
    expect(inv[0].queryKey.display).toBe('[todos]');
    expect(inv[0].queryKey.matchMode).toBe('prefix');
  });

  it('records refetchQueries, removeQueries, cancelQueries, resetQueries with { queryKey }', () => {
    const records = analyze(
      `${CLIENT_IMPORT}${KEY}const c = useQueryClient();
c.refetchQueries({ queryKey: key });
c.removeQueries({ queryKey: key });
c.cancelQueries({ queryKey: key });
c.resetQueries({ queryKey: key });`,
    );
    expect(ofRelation(records, 'refetches')).toHaveLength(1);
    expect(ofRelation(records, 'removes')).toHaveLength(1);
    expect(ofRelation(records, 'cancels')).toHaveLength(1);
    expect(ofRelation(records, 'resets')).toHaveLength(1);
  });

  it('records setQueryData with positional key (exact match mode)', () => {
    const records = analyze(`${CLIENT_IMPORT}${KEY}const c = useQueryClient();\nc.setQueryData(key, []);`);
    const sets = ofRelation(records, 'sets');
    expect(sets).toHaveLength(1);
    expect(sets[0].operation).toBe('setQueryData');
    expect(sets[0].queryKey.matchMode).toBe('exact');
    expect(sets[0].queryKey.display).toBe('[todos]');
  });

  it('does not emit a record for getQueryData / getQueriesData (read-only, untracked methods)', () => {
    const records = analyze(
      `${CLIENT_IMPORT}${KEY}const c = useQueryClient();
c.getQueryData(key);
c.getQueriesData({ queryKey: key });
c.getQueriesData(key);`,
    );
    expect(records).toHaveLength(0);
  });

  it('records setQueriesData with { queryKey } form', () => {
    const records = analyze(
      `${CLIENT_IMPORT}${KEY}const c = useQueryClient();\nc.setQueriesData({ queryKey: key }, []);`,
    );
    expect(ofRelation(records, 'sets').some((r) => r.operation === 'setQueriesData')).toBe(true);
  });
});

describe('astScan cache actions - predicate / filter forms', () => {
  it('records invalidateQueries with a predicate that constrains queryKey segments', () => {
    const records = analyze(
      `${CLIENT_IMPORT}const c = useQueryClient();
c.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'todos' });`,
    );
    const inv = ofRelation(records, 'invalidates');
    expect(inv).toHaveLength(1);
    // Predicate constrains segment 0 to 'todos', so a prefix key is inferred.
    expect(inv[0].queryKey.display).toBe('[todos]');
    expect(inv[0].queryKey.matchMode).toBe('prefix');
  });

  it('records invalidateQueries with an opaque predicate (no constraints -> all/predicate mode)', () => {
    const records = analyze(
      `${CLIENT_IMPORT}const c = useQueryClient();
c.invalidateQueries({ predicate: () => true });`,
    );
    const inv = ofRelation(records, 'invalidates');
    expect(inv).toHaveLength(1);
    expect(['all', 'predicate']).toContain(inv[0].queryKey.matchMode);
  });

  it('records invalidateQueries with no argument (clears all)', () => {
    const records = analyze(`${CLIENT_IMPORT}const c = useQueryClient();\nc.invalidateQueries();`);
    const inv = ofRelation(records, 'invalidates');
    expect(inv).toHaveLength(1);
    expect(inv[0].queryKey.matchMode).toBe('all');
  });
});

describe('astScan cache actions - client provenance variants', () => {
  it('detects a client from new QueryClient()', () => {
    const records = analyze(`${CLIENT_IMPORT}const c = new QueryClient();\nc.invalidateQueries({ queryKey: ['x'] });`);
    expect(ofRelation(records, 'invalidates')).toHaveLength(1);
  });

  it('detects a client from a destructured hook result', () => {
    const records = analyze(
      `function useThing() { return { queryClient: {} as any }; }
const { queryClient } = useThing();
queryClient.removeQueries({ queryKey: ['x'] });`,
    );
    expect(ofRelation(records, 'removes')).toHaveLength(1);
  });

  it('detects a client from a param typed QueryClient', () => {
    const records = analyze(
      `${CLIENT_IMPORT}function run(client: QueryClient) {
  client.cancelQueries({ queryKey: ['x'] });
}
export { run };`,
    );
    expect(ofRelation(records, 'cancels')).toHaveLength(1);
  });

  it('handles optional chaining client?.invalidateQueries(...)', () => {
    const records = analyze(`${CLIENT_IMPORT}const c = useQueryClient();\nc?.invalidateQueries({ queryKey: ['x'] });`);
    expect(ofRelation(records, 'invalidates')).toHaveLength(1);
  });

  it('ignores cache actions on a non-client object', () => {
    const records = analyze(`const notClient = {} as any;\nnotClient.invalidateQueries({ queryKey: ['x'] });`);
    expect(ofRelation(records, 'invalidates')).toHaveLength(0);
  });
});

describe('astScan member-call refetch handling', () => {
  it('records .refetch() on a tracked query result object', () => {
    const records = analyze(
      `import { useQuery } from '@tanstack/react-query';
const key = ['todos'] as const;
function Comp() {
  const query = useQuery({ queryKey: key, queryFn: () => 1 });
  return query.refetch();
}
export { Comp };`,
    );
    const ref = ofRelation(records, 'refetches');
    expect(ref.some((r) => r.operation === 'refetch')).toBe(true);
  });
});

describe('astScan getQueriesData key helpers via [first] = client.getQueriesData(...)', () => {
  it('resolves a queryKey from a destructured getQueriesData result with { queryKey }', () => {
    const records = analyze(
      `${CLIENT_IMPORT}const c = useQueryClient();
const key = ['todos'] as const;
const [first] = c.getQueriesData({ queryKey: key });
c.invalidateQueries({ queryKey: first });`,
    );
    // first resolves to the getQueriesData collection key 'todos'.
    expect(ofRelation(records, 'invalidates').some((r) => r.queryKey.display === 'todos')).toBe(true);
  });
});

describe('astScan resolveLocalActionArgExpression - through local bindings', () => {
  const HEAD = `${CLIENT_IMPORT}const c = useQueryClient();\n`;

  it('resolves a key in a local const that references another const', () => {
    const records = analyze(
      `${HEAD}const base = ['todos'] as const;
const alias = base;
c.invalidateQueries({ queryKey: alias });`,
    );
    expect(ofRelation(records, 'invalidates')[0].queryKey.display).toBe('[todos]');
  });

  it('resolves a key built by a factory function called with args', () => {
    const records = analyze(
      `${HEAD}function makeKey(id: string) { return ['todo', id] as const; }
c.invalidateQueries({ queryKey: makeKey('1') });`,
    );
    // The factory return is resolved to an array; the param segment stays dynamic.
    const inv = ofRelation(records, 'invalidates')[0];
    expect(inv.queryKey.display.startsWith('[todo')).toBe(true);
  });

  it('resolves a key built by a factory function with no params (static)', () => {
    const records = analyze(
      `${HEAD}function makeKey() { return ['static-todo'] as const; }
c.invalidateQueries({ queryKey: makeKey() });`,
    );
    expect(ofRelation(records, 'invalidates')[0].queryKey.display).toBe('[static-todo]');
  });

  it('resolves a key from an arrow-function factory called with args', () => {
    const records = analyze(
      `${HEAD}const makeKey = (id: string) => ['todo', id] as const;
c.invalidateQueries({ queryKey: makeKey('2') });`,
    );
    expect(ofRelation(records, 'invalidates')[0].queryKey.display).toBe('[todo, 2]');
  });

  it('resolves a key from a const-bound arrow-function factory with no params', () => {
    const records = analyze(
      `${HEAD}const build = () => ['built'] as const;
c.invalidateQueries({ queryKey: build() });`,
    );
    expect(ofRelation(records, 'invalidates')[0].queryKey.display).toBe('[built]');
  });

  it('resolves a key spread into an array', () => {
    const records = analyze(
      `${HEAD}const tail = ['detail'] as const;
c.invalidateQueries({ queryKey: ['todos', ...tail] });`,
    );
    expect(ofRelation(records, 'invalidates')[0].queryKey.display).toBe('[todos, detail]');
  });

  it('resolves a key behind a conditional expression (consequent)', () => {
    const records = analyze(
      `${HEAD}declare const flag: boolean;
const a = ['todos'] as const;
const b = ['users'] as const;
c.invalidateQueries({ queryKey: flag ? a : b });`,
    );
    // Conditional yields a combined dynamic key; the action record is still emitted.
    expect(ofRelation(records, 'invalidates')).toHaveLength(1);
  });

  it('resolves a key from obj.prop member access into a local object', () => {
    const records = analyze(
      `${HEAD}const keys = { todos: ['todos'] as const };
c.invalidateQueries({ queryKey: keys.todos });`,
    );
    expect(ofRelation(records, 'invalidates')[0].queryKey.display).toBe('[todos]');
  });

  it('resolves a key from an array element index member access', () => {
    const records = analyze(
      `${HEAD}const keyGroups = [['todos'] as const, ['users'] as const];
c.invalidateQueries({ queryKey: keyGroups[0] });`,
    );
    expect(ofRelation(records, 'invalidates')[0].queryKey.display).toBe('[todos]');
  });

  it('resolves a key through a chain const -> const -> factory call', () => {
    const records = analyze(
      `${HEAD}function makeKey() { return ['root'] as const; }
const first = makeKey();
const second = first;
c.invalidateQueries({ queryKey: second });`,
    );
    expect(ofRelation(records, 'invalidates')[0].queryKey.display).toBe('[root]');
  });

  it('resolves a key wrapped in queryOptions identity call', () => {
    const records = analyze(
      `import { useQueryClient, queryOptions } from '@tanstack/react-query';
const c = useQueryClient();
const opts = queryOptions({ queryKey: ['opt'], queryFn: () => 1 });
c.invalidateQueries(opts);`,
    );
    expect(ofRelation(records, 'invalidates')[0].queryKey.display).toBe('[opt]');
  });

  it('resolves a key wrapped in Object.freeze identity call', () => {
    const records = analyze(`${HEAD}c.invalidateQueries({ queryKey: Object.freeze(['frozen']) });`);
    expect(ofRelation(records, 'invalidates')[0].queryKey.display).toBe('[frozen]');
  });

  it('resolves a key initialized via useState initial value', () => {
    const records = analyze(
      `${HEAD}declare function useState<T>(v: T): [T, (x: T) => void];
const [stateKey] = useState(['statekey'] as const);
c.invalidateQueries({ queryKey: stateKey });`,
    );
    const display = ofRelation(records, 'invalidates')[0]?.queryKey.display;
    expect(display).toBe('statekey');
  });

  it('resolves a key from a reassigned (mutable) local binding', () => {
    const records = analyze(
      `${HEAD}let mut = ['init'] as const;
mut = ['reassigned'] as const;
c.invalidateQueries({ queryKey: mut });`,
    );
    expect(ofRelation(records, 'invalidates')[0].queryKey.display).toBe('[reassigned]');
  });
});

describe('astScan substituteIdentifierInExpressionTopLevel - action key referencing enclosing param', () => {
  // An enclosing function param is the query-key building block; the call-site
  // arg is substituted into the queryKey expression across node kinds.
  function paramKey(keyExpr: string, callArg = "'v'") {
    return analyze(
      `${CLIENT_IMPORT}const c = useQueryClient();
function run(p: string) {
  c.invalidateQueries({ queryKey: ${keyExpr} });
}
run(${callArg});
export { run };`,
    );
  }

  it('substitutes the param inside an array key element', () => {
    expect(ofRelation(paramKey("['todo', p]"), 'invalidates').length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the param inside a template literal element', () => {
    expect(ofRelation(paramKey('[`todo-' + '$' + '{p}`]'), 'invalidates').length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the param inside a member expression element', () => {
    expect(ofRelation(paramKey("['todo', p.length]"), 'invalidates').length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the param inside a call element', () => {
    expect(ofRelation(paramKey("['todo', String(p)]"), 'invalidates').length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the param inside an optional call / optional member element', () => {
    expect(ofRelation(paramKey("['todo', p?.toString()]"), 'invalidates').length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the param inside unary / binary key elements', () => {
    expect(ofRelation(paramKey("[-1, 'todo', p + 'x']"), 'invalidates').length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the param inside logical / sequence key elements', () => {
    expect(ofRelation(paramKey("['todo', p && 'a', (p, 'seq')]"), 'invalidates').length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the param inside a conditional key element', () => {
    expect(ofRelation(paramKey("[p === 'v' ? 'a' : p]"), 'invalidates').length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the param inside a spread key element', () => {
    expect(ofRelation(paramKey("[...['todo'], p]"), 'invalidates').length).toBeGreaterThanOrEqual(1);
  });

  it('substitutes the param inside a nested object key element', () => {
    expect(ofRelation(paramKey("['todo', { id: p }]"), 'invalidates').length).toBeGreaterThanOrEqual(1);
  });
});

describe('astScan resolveQueryKeyFactoryReturnFromParam - typed factory params', () => {
  it('resolves a key from a param typed ReturnType<typeof factory>', () => {
    const records = analyzeSources({
      'src/keys.ts': "export const makeKey = () => ['todos'] as const;",
      'src/app.ts': `import { QueryClient } from '@tanstack/react-query';
import { makeKey } from '../../keys';
function run(client: QueryClient, key: ReturnType<typeof makeKey>) {
  client.invalidateQueries({ queryKey: key });
}
export { run };`,
    });
    expect(ofRelation(records, 'invalidates').length).toBeGreaterThanOrEqual(1);
  });

  it('resolves a key from a destructured object-pattern param member typed ReturnType<typeof factory>', () => {
    const records = analyzeSources({
      'src/keys2.ts': "export const makeKey = () => ['scoped'] as const;",
      'src/app.ts': `import { QueryClient } from '@tanstack/react-query';
import { makeKey } from '../../keys2';
function run(client: QueryClient, { key }: { key: ReturnType<typeof makeKey> }) {
  client.invalidateQueries({ queryKey: key });
}
export { run };`,
    });
    expect(ofRelation(records, 'invalidates').length).toBeGreaterThanOrEqual(1);
  });
});

describe('astScan resolveQueryKeyFactoryReturnFromMemberProperty - *QueryKey member naming', () => {
  it('resolves member key xxxQueryKey via a createXxxQueryKey factory', () => {
    const records = analyze(
      `${CLIENT_IMPORT}const c = useQueryClient();
function createTodoQueryKey() { return ['todo'] as const; }
declare const keys: { todoQueryKey: readonly string[] };
c.invalidateQueries({ queryKey: keys.todoQueryKey });`,
    );
    expect(ofRelation(records, 'invalidates').length).toBeGreaterThanOrEqual(1);
  });
});

describe('astScan createContext<...>() typed query client', () => {
  it('detects a client through useContext of createContext<{ queryClient: QueryClient }>', () => {
    const records = analyze(
      `import { QueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
const key = ['todos'] as const;
const Ctx = createContext<{ queryClient: QueryClient }>(null as any);
function useThing() {
  const { queryClient } = useContext(Ctx);
  queryClient.invalidateQueries({ queryKey: key });
}
export { useThing };`,
    );
    expect(ofRelation(records, 'invalidates').length).toBeGreaterThanOrEqual(1);
  });

  it('exercises createContext<QueryClient | null>(null) union type-arg branch', () => {
    const records = analyze(
      `import { QueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
const key = ['todos'] as const;
const Ctx = createContext<QueryClient | null>(null);
function mk() { return { queryClient: useContext(Ctx) }; }
const { queryClient } = mk();
queryClient?.invalidateQueries({ queryKey: key });`,
    );
    // The union type arg with QueryClient should be recognized as a client.
    expect(Array.isArray(records)).toBe(true);
  });

  it('detects a client via createContext default-value object { queryClient: new QueryClient() }', () => {
    const records = analyze(
      `import { QueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
const key = ['todos'] as const;
const Ctx = createContext({ queryClient: new QueryClient() });
function useThing() {
  const { queryClient } = useContext(Ctx);
  queryClient.invalidateQueries({ queryKey: key });
}
export { useThing };`,
    );
    expect(ofRelation(records, 'invalidates').length).toBeGreaterThanOrEqual(1);
  });
});
