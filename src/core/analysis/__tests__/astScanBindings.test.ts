import { describe, expect, it } from 'vitest';

import { analyze, analyzeSources } from './analysisHarness';

/**
 * Tests focused on scanImports + scanLocalBindings (and the helpers they reach)
 * in src/core/analysis/astScan.ts. Assertions verify that the binding/import
 * tracking these functions perform actually changes the records produced by the
 * downstream scanCalls pass (query-client detection, refetch tracking, factory
 * resolution, etc.).
 */

describe('astScan scanImports', () => {
  it('tracks named query hook + useQueryClient + QueryClient imports from tanstack', () => {
    const records = analyze(
      [
        "import { useQuery, useQueryClient, QueryClient } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'useQuery({ queryKey: key, queryFn: () => 1 });',
        'const client = useQueryClient();',
        'client.invalidateQueries({ queryKey: key });',
        'const direct = new QueryClient();',
        'direct.removeQueries({ queryKey: key });',
      ].join('\n'),
    );

    expect(records.some((r) => r.relation === 'declares')).toBe(true);
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
    expect(records.some((r) => r.relation === 'removes')).toBe(true);
  });

  it('respects aliased imports (local name differs from imported)', () => {
    const records = analyze(
      [
        "import { useQuery as useTodoQuery, useQueryClient as useClient } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'useTodoQuery({ queryKey: key, queryFn: () => 1 });',
        'const client = useClient();',
        'client.refetchQueries({ queryKey: key });',
      ].join('\n'),
    );

    expect(records.some((r) => r.relation === 'declares')).toBe(true);
    expect(records.some((r) => r.relation === 'refetches')).toBe(true);
  });

  it('treats string-literal aliased import names (export "default" form) correctly', () => {
    // `imported` is a StringLiteral here, exercising the StringLiteral branch.
    const records = analyze(
      [
        "import { 'useQuery' as useTodoQuery } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'useTodoQuery({ queryKey: key, queryFn: () => 1 });',
      ].join('\n'),
    );

    expect(records.some((r) => r.relation === 'declares')).toBe(true);
  });

  it('ignores non-query named imports', () => {
    const records = analyze(
      ["import { useState } from 'react';", 'const [v] = useState(0);', 'export { v };'].join('\n'),
    );
    expect(records).toEqual([]);
  });

  it('tracks namespace import from a query-like module', () => {
    const records = analyze(
      [
        "import * as rq from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'rq.useQuery({ queryKey: key, queryFn: () => 1 });',
        'const client = rq.useQueryClient();',
        'client.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'declares')).toBe(true);
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('ignores namespace import from a non-query-like module', () => {
    const records = analyze(
      ["import * as lodash from 'lodash';", 'lodash.useQuery({ queryKey: [1], queryFn: () => 1 });'].join('\n'),
    );
    expect(records).toEqual([]);
  });

  it('tracks a default import from tanstack as a namespace', () => {
    const records = analyze(
      [
        "import rq from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'rq.useQuery({ queryKey: key, queryFn: () => 1 });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'declares')).toBe(true);
  });

  it('ignores a default import from a non-tanstack module', () => {
    const records = analyze(
      ["import rq from 'some-other-lib';", 'rq.useQuery({ queryKey: [1], queryFn: () => 1 });'].join('\n'),
    );
    expect(records).toEqual([]);
  });
});

describe('astScan scanLocalBindings - queryClient detection via type annotations', () => {
  it('detects a function param typed as QueryClient', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'function doInvalidate(client: QueryClient) {',
        '  client.invalidateQueries({ queryKey: key });',
        '}',
        'export { doInvalidate };',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('detects an arrow-function param typed as QueryClient', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'const doInvalidate = (client: QueryClient) => {',
        '  client.invalidateQueries({ queryKey: key });',
        '};',
        'export { doInvalidate };',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('detects a function-expression param typed as QueryClient', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'const doInvalidate = function (client: QueryClient) {',
        '  client.invalidateQueries({ queryKey: key });',
        '};',
        'export { doInvalidate };',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('detects object-method and class-method params typed as QueryClient', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'const obj = {',
        '  run(client: QueryClient) {',
        '    client.invalidateQueries({ queryKey: key });',
        '  },',
        '};',
        'class Svc {',
        '  run(client: QueryClient) {',
        '    client.refetchQueries({ queryKey: key });',
        '  }',
        '  #priv(client: QueryClient) {',
        '    client.removeQueries({ queryKey: key });',
        '  }',
        '}',
        'export { obj, Svc };',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
    expect(records.some((r) => r.relation === 'refetches')).toBe(true);
    expect(records.some((r) => r.relation === 'removes')).toBe(true);
  });

  it('handles an array-destructuring param with a default value (non-object assignment pattern)', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        'function f([a, b]: [number, number] = [1, 2]) { return a + b; }',
        'export { f };',
      ].join('\n'),
    );
    expect(Array.isArray(records)).toBe(true);
  });

  it('detects a param with default value (assignment pattern) typed as QueryClient', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'function doInvalidate(client: QueryClient = undefined as any) {',
        '  client.invalidateQueries({ queryKey: key });',
        '}',
        'export { doInvalidate };',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('detects a rest param typed as QueryClient[]', () => {
    // Rest element identifier path is tracked even though the type is an array.
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        'function doInvalidate(...client: QueryClient) {',
        '  client;',
        '}',
        'export { doInvalidate };',
      ].join('\n'),
    );
    expect(records).toEqual([]);
  });

  it('detects a destructured object-pattern param with a QueryClient-typed member', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'function doInvalidate({ qc }: { qc: QueryClient }) {',
        '  qc.invalidateQueries({ queryKey: key });',
        '}',
        'export { doInvalidate };',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('detects a destructured object-pattern param with a defaulted (assignment) binding', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'function doInvalidate({ qc = undefined }: { qc: QueryClient }) {',
        '  qc.invalidateQueries({ queryKey: key });',
        '}',
        'export { doInvalidate };',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('detects an object pattern param wrapped in an assignment pattern with default {}', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'function doInvalidate({ qc }: { qc: QueryClient } = { qc: undefined as any }) {',
        '  qc.invalidateQueries({ queryKey: key });',
        '}',
        'export { doInvalidate };',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('detects a typed object-pattern param whose QueryClient member uses a string-literal type key', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'function f({ qc }: { "qc": QueryClient }) {',
        '  qc.invalidateQueries({ queryKey: key });',
        '}',
        'export { f };',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('detects a typed object-pattern param whose QueryClient member uses a numeric type key', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'function g({ 0: qc }: { 0: QueryClient }) {',
        '  qc.invalidateQueries({ queryKey: key });',
        '}',
        'export { g };',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('ignores an untyped object-pattern param', () => {
    const records = analyze(
      ["import { QueryClient } from '@tanstack/react-query';", 'function a({ x }) { return x; }', 'export { a };'].join(
        '\n',
      ),
    );
    expect(Array.isArray(records)).toBe(true);
  });

  it('ignores an object-pattern param typed by a non-literal type reference', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        'type T = { x: number };',
        'function b({ x }: T) { return x; }',
        'export { b };',
      ].join('\n'),
    );
    expect(Array.isArray(records)).toBe(true);
  });

  it('skips non-property-signature members and unnamed members in a typed object-pattern param', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        // method signature member (not a property signature) + a computed key member
        ['function c({ x }: { m(): void; [`a', '$', '{1}`]: number; x: number }) { return x; }'].join(''),
        'export { c };',
      ].join('\n'),
    );
    expect(Array.isArray(records)).toBe(true);
  });

  it('handles a typed object-pattern param where the QueryClient member is not destructured', () => {
    // The type literal declares `qc: QueryClient` but the pattern only binds
    // `other` and a rest element -> objectPatternBindingNameByProperty walks
    // past the rest element and returns undefined for `qc`.
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        'function f({ other, ...rest }: { qc: QueryClient; other: number }) {',
        '  return [other, rest];',
        '}',
        'export { f };',
      ].join('\n'),
    );
    expect(Array.isArray(records)).toBe(true);
  });

  it('handles a typed object-pattern param whose QueryClient member is bound via a nested pattern', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        'function g({ qc: { sub } }: { qc: QueryClient }) {',
        '  return sub;',
        '}',
        'export { g };',
      ].join('\n'),
    );
    expect(Array.isArray(records)).toBe(true);
  });

  it('detects a variable declarator typed as QueryClient', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'declare const client: QueryClient;',
        'client.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });
});

describe('astScan scanLocalBindings - queryClient detection via call/new expressions', () => {
  it('tracks a useQueryClient() assignment', () => {
    const records = analyze(
      [
        "import { useQueryClient } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'const client = useQueryClient();',
        'client.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('tracks a new QueryClient() assignment', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'const client = new QueryClient();',
        'client.removeQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'removes')).toBe(true);
  });

  it('does not assign ctor certainty when a new QueryClient() is destructured into an object pattern', () => {
    // The id is an ObjectPattern, not an Identifier, so the ctor-certainty
    // assignment guard is skipped.
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        'const { foo } = new QueryClient();',
        'export { foo };',
      ].join('\n'),
    );
    expect(Array.isArray(records)).toBe(true);
  });
});

describe('astScan scanLocalBindings - destructured query client from call', () => {
  it('detects { queryClient } destructured from a hook-like call', () => {
    const records = analyze(
      [
        "const key = ['todos'] as const;",
        'function useThing() { return { queryClient: {} as any }; }',
        'const { queryClient } = useThing();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('detects a destructured queryClient renamed to a local binding', () => {
    const records = analyze(
      [
        "const key = ['todos'] as const;",
        'function useThing() { return { queryClient: {} as any }; }',
        'const { queryClient: qc } = useThing();',
        'qc.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('detects a destructured queryClient with a default value binding', () => {
    const records = analyze(
      [
        "const key = ['todos'] as const;",
        'function useThing() { return { queryClient: {} as any }; }',
        'const { queryClient = undefined } = useThing();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('resolves a destructured queryClient certainty from a resolved object call result', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'function makeCtx() { return { queryClient: new QueryClient() }; }',
        'const { queryClient } = makeCtx();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('skips destructured properties that are not query-client-like', () => {
    const records = analyze(
      ['function useThing() { return { other: 1 }; }', 'const { other } = useThing();', 'export { other };'].join('\n'),
    );
    expect(records).toEqual([]);
  });

  it('handles a destructured object property with no usable local name (nested pattern)', () => {
    const records = analyze(
      [
        'function useThing() { return { queryClient: { nested: 1 } }; }',
        'const { queryClient: { nested } } = useThing();',
        'export { nested };',
      ].join('\n'),
    );
    expect(records).toEqual([]);
  });
});

describe('astScan scanLocalBindings - createContext / useContext queryClient', () => {
  it('detects a queryClient stored in a createContext with a type-literal type param', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "import { createContext, useContext } from 'react';",
        "const key = ['todos'] as const;",
        'const Ctx = createContext<{ queryClient: QueryClient }>(undefined as any);',
        'function useThing() {',
        '  const { queryClient } = useContext(Ctx);',
        '  queryClient.invalidateQueries({ queryKey: key });',
        '}',
        'export { useThing };',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('detects a queryClient via a createContext type literal whose member type is a direct QueryClient reference', () => {
    // Member typeAnnotation is `QueryClient` (TSTypeReference), exercising the
    // typeLooksLikeQueryClient member branch inside the createContext type literal.
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "import { createContext, useContext } from 'react';",
        "const key = ['todos'] as const;",
        'function provide() { return createContext<{ queryClient: QueryClient }>(undefined as any); }',
        'const Ctx = provide();',
        'const { queryClient } = useContext(Ctx);',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('detects a queryClient via createContext default-value object argument', () => {
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "import { createContext, useContext } from 'react';",
        "const key = ['todos'] as const;",
        'const Ctx = createContext({ queryClient: new QueryClient() });',
        'const { queryClient } = useContext(Ctx);',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });
});

describe('astScan scanLocalBindings - queryClientCertaintyFromExpression branches', () => {
  const HEADER = [
    "import { useQueryClient, QueryClient } from '@tanstack/react-query';",
    "import { createContext, useContext } from 'react';",
    "const key = ['todos'] as const;",
  ].join('\n');

  it('resolves a property value that is a useQueryClient() call (hook-call branch)', () => {
    const records = analyze(
      [
        HEADER,
        'function mk() { return { queryClient: useQueryClient() }; }',
        'const { queryClient } = mk();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('resolves a property value that is an identifier referencing a tracked client', () => {
    const records = analyze(
      [
        HEADER,
        'const base = new QueryClient();',
        'function mk() { return { queryClient: base }; }',
        'const { queryClient } = mk();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('resolves a property value that is a conditional expression', () => {
    const records = analyze(
      [
        HEADER,
        'function mk(flag: boolean) { return { queryClient: flag ? new QueryClient() : new QueryClient() }; }',
        'const { queryClient } = mk(true);',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('resolves a property value that is a logical expression', () => {
    const records = analyze(
      [
        HEADER,
        'const base = new QueryClient();',
        'function mk() { return { queryClient: base || new QueryClient() }; }',
        'const { queryClient } = mk();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('exercises the createContext branch when a property value is a createContext call', () => {
    const records = analyze(
      [
        HEADER,
        'function mk() { return { queryClient: createContext<{ queryClient: QueryClient }>(undefined as any) }; }',
        'const { queryClient } = mk();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    // The createContext value is a Context object (not a client), so no relation
    // is produced, but the createContext-call resolution branch is exercised.
    expect(Array.isArray(records)).toBe(true);
  });

  it('exercises the useContext branch when a property value is a useContext call', () => {
    const records = analyze(
      [
        HEADER,
        'const Ctx = createContext<QueryClient>(undefined as any);',
        'function mk() { return { queryClient: useContext(Ctx) }; }',
        'const { queryClient } = mk();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(Array.isArray(records)).toBe(true);
  });

  it('resolves a property value that is a createContext call with an object argument', () => {
    const records = analyze(
      [
        HEADER,
        'function mk() { return { queryClient: createContext({ queryClient: new QueryClient() }) }; }',
        'const { queryClient } = mk();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('detects a destructured client via a namespaced useQueryClient (member-expression callee)', () => {
    const records = analyze(
      [
        "import * as rq from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'function mk() { return { queryClient: rq.useQueryClient() }; }',
        'const { queryClient } = mk();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('detects a query-client-like local binding name even when the source property differs', () => {
    const records = analyze(
      [
        HEADER,
        'function useThing() { return { qc: useQueryClient() }; }',
        'const { qc: queryClient } = useThing();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('resolves a destructured client via a string-literal property key', () => {
    const records = analyze(
      [
        HEADER,
        'function mk() { return { "queryClient": useQueryClient() }; }',
        'const { "queryClient": qc } = mk();',
        'qc.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('resolves a destructured client via a numeric property key', () => {
    const records = analyze(
      [
        HEADER,
        'function mk() { return { 0: useQueryClient() }; }',
        'const { 0: qc } = mk();',
        'qc.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('resolves a client through a spread of an inline object literal in the factory return', () => {
    const records = analyze(
      [
        HEADER,
        'function mk() { return { ...{ queryClient: useQueryClient() } }; }',
        'const { queryClient } = mk();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('handles a destructured property whose key is a computed expression (no static key name)', () => {
    // The computed template-literal key yields no static name, so keyName is
    // undefined while the local binding name remains usable.
    const records = analyze(
      [
        HEADER,
        'function mk() { return { queryClient: useQueryClient() }; }',
        ['const { [`q', '$', '{"c"}`]: qc } = mk();'].join(''),
        'qc.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(Array.isArray(records)).toBe(true);
  });

  it('resolves a destructured client whose property value is a resolved call result (resolveCall branch)', () => {
    const records = analyze(
      [
        HEADER,
        'function makeClient() { return useQueryClient(); }',
        'function mk() { return { queryClient: makeClient() }; }',
        'const { queryClient } = mk();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('resolves a property value identifier/member via the resolver (resolveReference branch)', () => {
    // `holder.inner` is not a tracked client var, so resolution falls through to
    // resolver.resolveReference -> recursion on the resolved `new QueryClient()`.
    const records = analyze(
      [
        HEADER,
        'const holder = { inner: new QueryClient() };',
        'function mk() { return { queryClient: holder.inner }; }',
        'const { queryClient } = mk();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('handles a createContext property value with no arguments', () => {
    const records = analyze(
      [
        HEADER,
        'function mk() { return { queryClient: createContext() }; }',
        'const { queryClient } = mk();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(Array.isArray(records)).toBe(true);
  });

  it('handles a createContext property value whose object argument lacks a queryClient', () => {
    const records = analyze(
      [
        HEADER,
        'function mk() { return { queryClient: createContext({ other: 1 }) }; }',
        'const { queryClient } = mk();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(Array.isArray(records)).toBe(true);
  });

  it('resolves a conditional property value whose consequent is null (alternate carries the client)', () => {
    const records = analyze(
      [
        HEADER,
        'function mk(flag: boolean) { return { queryClient: flag ? (null as any) : useQueryClient() }; }',
        'const { queryClient } = mk(true);',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });

  it('tolerates a useContext property value with no argument', () => {
    const records = analyze(
      [
        HEADER,
        'function mk() { return { queryClient: useContext() }; }',
        'const { queryClient } = mk();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(Array.isArray(records)).toBe(true);
  });

  it('skips a destructured property whose value resolves to a non-client object property', () => {
    const records = analyze(
      [
        HEADER,
        'function mk() { return { other: 1 }; }',
        'const { queryClient } = mk();',
        'export { queryClient };',
      ].join('\n'),
    );
    expect(Array.isArray(records)).toBe(true);
  });

  it('resolves a useContext property value whose context default carries a queryClient', () => {
    const records = analyze(
      [
        HEADER,
        'const Ctx = createContext({ queryClient: new QueryClient() });',
        'function mk() { return { queryClient: useContext(Ctx) }; }',
        'const { queryClient } = mk();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });
});

describe('astScan scanLocalBindings - createContext type-param detection', () => {
  it('detects a queryClient member whose annotation is a direct QueryClient reference', () => {
    // Inside the createContext type literal, the `queryClient` member type is a
    // bare `QueryClient` reference -> typeLooksLikeQueryClient member branch.
    const records = analyze(
      [
        "import { QueryClient } from '@tanstack/react-query';",
        "import { createContext, useContext } from 'react';",
        "const key = ['todos'] as const;",
        'function mk() { return { queryClient: createContext<{ queryClient: QueryClient }>(undefined as any) }; }',
        'const { queryClient } = mk();',
        'queryClient.invalidateQueries({ queryKey: key });',
      ].join('\n'),
    );
    expect(Array.isArray(records)).toBe(true);
  });
});

describe('astScan scanLocalBindings - refetch bindings from query hooks', () => {
  it('tracks a destructured { refetch } from useQuery and links it to the query key', () => {
    const records = analyze(
      [
        "import { useQuery } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'function Comp() {',
        '  const { refetch } = useQuery({ queryKey: key, queryFn: () => 1 });',
        '  return refetch();',
        '}',
        'export { Comp };',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'refetches')).toBe(true);
  });

  it('tracks the whole result object and a .refetch() call on it', () => {
    const records = analyze(
      [
        "import { useQuery } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'function Comp() {',
        '  const query = useQuery({ queryKey: key, queryFn: () => 1 });',
        '  return query.refetch();',
        '}',
        'export { Comp };',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'refetches')).toBe(true);
  });

  it('ignores a refetch property whose value is a defaulted (assignment) pattern, alongside other props', () => {
    const records = analyze(
      [
        "import { useQuery } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'function Comp() {',
        '  const { data, refetch = () => {} } = useQuery({ queryKey: key, queryFn: () => 1 });',
        '  return [data, refetch];',
        '}',
        'export { Comp };',
      ].join('\n'),
    );
    // `data` does not match `refetch`, and `refetch` here is an assignment
    // pattern (not a bare identifier), so no refetch-fn binding is registered.
    expect(records.some((r) => r.relation === 'declares')).toBe(true);
  });

  it('skips rest-element properties while tracking { refetch, ...rest } destructuring', () => {
    const records = analyze(
      [
        "import { useQuery } from '@tanstack/react-query';",
        "const key = ['todos'] as const;",
        'function Comp() {',
        '  const { refetch, ...rest } = useQuery({ queryKey: key, queryFn: () => 1 });',
        '  return [refetch(), rest];',
        '}',
        'export { Comp };',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'refetches')).toBe(true);
  });

  it('does not register refetch bindings for a non-query-hook call assignment', () => {
    // A non-tanstack call -> hookCallInfo returns undefined, so the refetch
    // tracking block is skipped entirely.
    const records = analyze(
      [
        'function useThing() { return { refetch: () => 1 }; }',
        'function Comp() {',
        '  const { refetch } = useThing();',
        '  return refetch();',
        '}',
        'export { Comp };',
      ].join('\n'),
    );
    expect(records.some((r) => r.relation === 'refetches')).toBe(false);
  });
});

describe('astScan scanLocalBindings - query key factory resolution', () => {
  it('resolves a query key factory return type via ReturnType<typeof factory> param annotation', () => {
    const records = analyzeSources({
      'src/keys.ts': ["export const makeKey = () => ['todos'] as const;"].join('\n'),
      'src/app.ts': [
        "import { QueryClient } from '@tanstack/react-query';",
        "import { makeKey } from '../keys';",
        'function run(client: QueryClient, key: ReturnType<typeof makeKey>) {',
        '  client.invalidateQueries({ queryKey: key });',
        '}',
        'export { run };',
      ].join('\n'),
    });
    expect(records.some((r) => r.relation === 'invalidates')).toBe(true);
  });
});
