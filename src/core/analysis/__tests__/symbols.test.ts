import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import * as t from '../ast';
import { parseSource } from '../sourceParser';
import { buildFileSymbols, buildSymbolIndex, extractFunctionReturnExpression, normalizeAnalyzerPath } from '../symbols';

function symbolsFor(source: string) {
  return buildFileSymbols('/repo/src/keys.ts', parseSource(source, '/repo/src/keys.ts'));
}

describe('core/analysis/symbols', () => {
  it('collects imports, exports, local symbols, and mutable bindings', () => {
    const symbols = symbolsFor(`
      import defaultClient, { queryOptions, remoteKey as aliasKey } from '../remote';
      import * as queryApi from '../queryApi';

      const source = makeSource();
      const localQueryKey = ['local'] as const;
      let mutableQueryKey = ['start'];
      mutableQueryKey = ['next'];
      const { queryKey, rqKey: renamedRqKey, ['dash-key']: dashKey, 1: numericKey, nested: { queryKey: nestedQueryKey = ['fallback'] }, ...restQueryKey } = source;
      const { queryKey: defaultedQueryKey = ['fallback'] } = source;
      const [firstQueryKey, , ...restArrayQueryKey] = source.items;
      const [topArrayQueryKey] = source.items;
      const ignoredInside = () => {
        const nested = 1;
        return nested;
      };

      export const exportedQueryKey = ['exported'];
      export const exportedNoReturnQueryKey = () => {
        source.run();
      };
      export class ExportedThing {}
      export function exportedFactory() {
        label: {
          return exportedQueryKey;
        }
      }
      function makeQueryKey() {
        if (source.ready) {
          return ['if'];
        }
        return ['else'];
      }
      const chainedQueryKey = () => {
        const first = ['first'] as const;
        const second = first;
        return second!;
      };
      export { localQueryKey as renamedLocal };
      export { remoteKey as renamedRemote } from '../remote';
      export * from '../all';
      export default function defaultFactory() {
        switch (source.kind) {
          case 'case':
            return ['case'];
          default:
            return ['default'];
        }
      }
    `);

    expect(symbols.imports.get('defaultClient')).toEqual({
      kind: 'default',
      source: '../remote',
      imported: 'default',
    });
    expect(symbols.imports.get('queryOptions')).toEqual({
      kind: 'named',
      source: '../remote',
      imported: 'queryOptions',
    });
    expect(symbols.imports.get('aliasKey')).toEqual({
      kind: 'named',
      source: '../remote',
      imported: 'remoteKey',
    });
    expect(symbols.imports.get('queryApi')).toEqual({ kind: 'namespace', source: '../queryApi' });

    expect(symbols.exports.get('renamedLocal')).toBe('localQueryKey');
    expect(symbols.exports.get('exportedQueryKey')).toBe('exportedQueryKey');
    expect(symbols.exports.get('ExportedThing')).toBeUndefined();
    expect(symbols.exports.get('exportedFactory')).toBe('exportedFactory');
    expect(symbols.exports.get('default')).toBe('defaultFactory');
    expect(symbols.reExports).toEqual([
      { source: '../remote', imported: 'remoteKey', exported: 'renamedRemote', all: false },
      { source: '../all', all: true },
    ]);

    expect(symbols.values.has('localQueryKey')).toBe(true);
    expect(symbols.values.has('queryKey')).toBe(true);
    expect(symbols.values.has('renamedRqKey')).toBe(true);
    expect(symbols.values.has('dashKey')).toBe(true);
    expect(symbols.values.has('numericKey')).toBe(true);
    expect(symbols.values.has('nestedQueryKey')).toBe(true);
    expect(symbols.values.has('defaultedQueryKey')).toBe(true);
    expect(symbols.values.has('restQueryKey')).toBe(true);
    expect(symbols.values.has('firstQueryKey')).toBe(true);
    expect(symbols.values.has('restArrayQueryKey')).toBe(true);
    expect(symbols.values.has('topArrayQueryKey')).toBe(true);
    expect(symbols.values.has('nested')).toBe(false);
    expect(symbols.mutableValues.has('mutableQueryKey')).toBe(true);

    const exportedReturn = symbols.functions.get('exportedFactory');
    expect(exportedReturn && t.isIdentifier(exportedReturn) ? exportedReturn.name : undefined).toBe('exportedQueryKey');

    const chainedReturn = symbols.functions.get('chainedQueryKey');
    expect(chainedReturn && t.isArrayExpression(chainedReturn)).toBe(true);

    const defaultReturn = symbols.functions.get('defaultFactory');
    expect(defaultReturn && t.isArrayExpression(defaultReturn)).toBe(true);
  });

  it('handles anonymous default functions and symbol indexes', () => {
    const filePath = normalizeAnalyzerPath(path.join('repo', 'src', 'anonymous.ts'));
    const ast = parseSource(
      `
        export default () => ['anonymous'];
        const localOnly = () => {
          try {
            return ['try'];
          } catch {
            return ['catch'];
          } finally {
            return ['finally'];
          }
        };
      `,
      filePath,
    );

    const symbols = buildFileSymbols(filePath, ast);
    const returned = symbols.functions.get('__default_export__');
    expect(symbols.exports.get('default')).toBe('__default_export__');
    expect(returned && t.isArrayExpression(returned)).toBe(true);

    const index = buildSymbolIndex(new Map([[filePath, ast]]));
    expect(index.fileSet.has(filePath)).toBe(true);
    expect(index.files.get(filePath)?.exports.get('default')).toBe('__default_export__');
  });

  it('extracts undefined when a function has no expression return', () => {
    const ast = parseSource(
      `
      function emptyQueryKey() {
        return;
      }
    `,
      '/repo/src/empty.ts',
    );
    const statement = ast.program.body[0];

    expect(t.isFunctionDeclaration(statement) ? extractFunctionReturnExpression(statement) : 'missing').toBeUndefined();
  });

  it('handles fallback returns, default identifiers, and skipped local declarations', () => {
    const symbols = symbolsFor(`
      const source = makeSource();
      const local = ['named'] as const;
      const defaultTarget = ['default-target'] as const;
      export { local as "literal-export" };
      export default defaultTarget;

      function noCaseQueryKey() {
        switch (source.kind) {}
      }

      function secondCaseQueryKey() {
        switch (source.kind) {
          case 'skip':
            source.run();
            break;
          case 'hit':
            return ['second-case'] as const;
        }
      }

      function alternateOnlyQueryKey() {
        if (source.ready) {
          source.run();
        } else {
          return ['alternate'] as const;
        }
      }

      function noBranchReturnQueryKey() {
        if (source.ready) {
          source.run();
        }
      }

      function catchQueryKey() {
        try {
          source.run();
        } catch {
          return ['catch'] as const;
        }
      }

      function noCatchReturnQueryKey() {
        try {
          source.run();
        } catch {
          source.recover();
        }
      }

      function finalQueryKey() {
        try {
          source.run();
        } finally {
          return ['finally'] as const;
        }
      }

      function missingAliasQueryKey() {
        let alias;
        return alias;
      }

      function recursiveAliasQueryKey() {
        const alias = alias;
        return alias;
      }

      function mutuallyRecursiveAliasQueryKey() {
        const first = second;
        const second = first;
        return first;
      }

      function outer() {
        function nestedQueryKey() {
          return ['nested'] as const;
        }
        const { queryKey } = makeSource();
        const { queryKey: collectedQueryKey } = makeSource();
        const { queryKey: localQueryKey = ['inner'] as const } = source;
        const { [source.key]: computedQueryKey } = source;
        const { items: [arrayInsideQueryKey = ['fallback'] as const, { objectInsideQueryKey }, [nestedArrayQueryKey]] } = source;
        let [firstQueryKey, , ...restQueryKey] = source.items;
        ({ firstQueryKey, ...restQueryKey } = source);
        [firstQueryKey, , ...restQueryKey] = source.items;
        firstQueryKey++;
        source.member++;
        return nestedQueryKey;
      }

      function nestedObjectQueryKeyCollector() {
        const { queryKey } = { queryKey: ['object-init'] as const };
        return queryKey;
      }

      function nestedArrayQueryKeyCollector() {
        const [queryKey] = [['array-init'] as const];
        return queryKey;
      }

      function nestedMemberQueryKeyCollector() {
        const { queryKey } = source.member;
        return queryKey;
      }

      export const { exportedPattern } = source;
      export const [arrayExport] = source.items;
      export let exportedNoInitQueryKey;
    `);

    expect(symbols.exports.get('literal-export')).toBe('local');
    expect(symbols.exports.get('default')).toBe('defaultTarget');
    expect(symbols.exports.get('exportedNoInitQueryKey')).toBe('exportedNoInitQueryKey');
    expect(symbols.functions.has('noCaseQueryKey')).toBe(false);
    expect(symbols.functions.get('secondCaseQueryKey')).toSatisfy(t.isArrayExpression);
    expect(symbols.functions.get('alternateOnlyQueryKey')).toSatisfy(t.isArrayExpression);
    expect(symbols.functions.has('noBranchReturnQueryKey')).toBe(false);
    expect(symbols.functions.get('catchQueryKey')).toSatisfy(t.isArrayExpression);
    expect(symbols.functions.has('noCatchReturnQueryKey')).toBe(false);
    expect(symbols.functions.get('finalQueryKey')).toSatisfy(t.isArrayExpression);
    expect(symbols.functions.get('missingAliasQueryKey')).toSatisfy(t.isIdentifier);
    expect(symbols.functions.get('recursiveAliasQueryKey')).toSatisfy(t.isIdentifier);
    expect(symbols.functions.get('mutuallyRecursiveAliasQueryKey')).toSatisfy(t.isIdentifier);
    expect(symbols.functions.get('nestedQueryKey')).toSatisfy(t.isArrayExpression);
    expect(symbols.values.has('queryKey')).toBe(true);
    expect(symbols.values.has('collectedQueryKey')).toBe(true);
    expect(symbols.values.has('computedQueryKey')).toBe(false);
    expect(symbols.values.has('arrayInsideQueryKey')).toBe(true);
    expect(symbols.values.has('objectInsideQueryKey')).toBe(true);
    expect(symbols.values.has('nestedArrayQueryKey')).toBe(true);
    expect(symbols.mutableValues.has('firstQueryKey')).toBe(true);
    expect(symbols.mutableValues.has('restQueryKey')).toBe(true);
  });

  it('handles string-named re-exports and unusual return extraction inputs', () => {
    const symbols = symbolsFor(`
      export { "remote-query-key" as queryKeyFromString } from '../remote';
      export function noReturnFactory() {
        source.run();
      }
      export default function namedDefaultWithoutReturn() {
        source.run();
      }
    `);
    const anonymousDefault = symbolsFor(`
      export default function() {
        return ['anonymous-default'] as const;
      }
    `);
    const literalDefault = symbolsFor(`
      export default ['literal-default'] as const;
    `);
    const callbackDefaultWithoutReturn = symbolsFor(`
      export default () => {
        source.run();
      };
    `);

    expect(symbols.reExports).toContainEqual({
      source: '../remote',
      imported: 'remote-query-key',
      exported: 'queryKeyFromString',
      all: false,
    });
    expect(symbols.functions.has('noReturnFactory')).toBe(false);
    expect(symbols.functionNodes.has('noReturnFactory')).toBe(true);
    expect(symbols.exports.get('default')).toBe('namedDefaultWithoutReturn');
    expect(symbols.functionNodes.has('namedDefaultWithoutReturn')).toBe(true);
    expect(anonymousDefault.exports.has('default')).toBe(false);
    expect(literalDefault.exports.get('default')).toBe('__default_export__');
    expect(literalDefault.values.get('__default_export__')).toSatisfy(t.isArrayExpression);
    expect(callbackDefaultWithoutReturn.exports.get('default')).toBe('__default_export__');
    expect(callbackDefaultWithoutReturn.functionNodes.has('__default_export__')).toBe(true);
    expect(callbackDefaultWithoutReturn.functions.has('__default_export__')).toBe(false);

    expect(
      extractFunctionReturnExpression({
        type: 'FunctionExpression',
        id: null,
        params: [],
        body: t.identifier('notBlock') as never,
        generator: false,
        async: false,
      }),
    ).toBeUndefined();
  });

  it('covers parenthesized returns, loop returns, namespace imports, and skipped patterns', () => {
    const symbols = symbolsFor(`
      import * as namespaceApi from '../namespace';

      export const exportedArrowQueryKey = () => (['arrow'] as const);
      export const exportedFunctionExpressionQueryKey = function() {
        return (['function-expression'] as const);
      };
      const wrappedQueryKey = (((['wrapped'] as const)));
      const { notTracked } = source;
      const { [source.key]: skippedComputed } = source;
      const [plainFirst] = source.items;
      const [queryKey, aliasQueryKey = ['fallback'] as const] = source.items;

      function forQueryKey() {
        for (const entry of source.items) {
          return (entry.queryKey);
        }
      }

      function whileQueryKey() {
        while (source.ready) {
          return ['while'] as const;
        }
      }

      function doQueryKey() {
        do {
          return ['do'] as const;
        } while (source.ready);
      }

      function forInQueryKey() {
        for (const key in source.items) {
          return [key] as const;
        }
      }

      const localNotQuery = 1;
      localNotQuery++;
      namespaceApi.value++;
    `);

    expect(symbols.imports.get('namespaceApi')).toEqual({ kind: 'namespace', source: '../namespace' });
    expect(symbols.functions.get('exportedArrowQueryKey')).toSatisfy(t.isArrayExpression);
    expect(symbols.functions.get('exportedFunctionExpressionQueryKey')).toSatisfy(t.isArrayExpression);
    expect(symbols.values.get('wrappedQueryKey')).toSatisfy(t.isArrayExpression);
    expect(symbols.values.has('notTracked')).toBe(true);
    expect(symbols.values.has('skippedComputed')).toBe(false);
    expect(symbols.values.has('plainFirst')).toBe(true);
    expect(symbols.values.has('queryKey')).toBe(true);
    expect(symbols.values.has('aliasQueryKey')).toBe(true);
    expect(symbols.functions.get('forQueryKey')).toSatisfy(t.isMemberExpression);
    expect(symbols.functions.get('whileQueryKey')).toSatisfy(t.isArrayExpression);
    expect(symbols.functions.get('doQueryKey')).toSatisfy(t.isArrayExpression);
    expect(symbols.functions.get('forInQueryKey')).toSatisfy(t.isArrayExpression);
    expect(symbols.mutableValues.has('localNotQuery')).toBe(true);
    expect(symbols.mutableValues.has('namespaceApi')).toBe(false);
  });

  it('skips nested non-query declarations and non-collecting query patterns', () => {
    const symbols = symbolsFor(`
      const source = makeSource();

      function outer() {
        // Nested, non-top-level, non-query named declaration -> skipped.
        function helperUnrelated() {
          return ['nested-helper'] as const;
        }
        // Nested querykey-named object pattern whose init is a plain identifier
        // (not a call/object/array expression) -> reaches but does not early-return.
        const { queryKey: plainIdentInit } = source;
        // Nested querykey-named pattern bound from a query-key symbol name.
        const { rqKeyNested } = source;
        return helperUnrelated(plainIdentInit, rqKeyNested);
      }

      outer();
    `);

    expect(symbols.functions.has('helperUnrelated')).toBe(false);
    expect(symbols.values.has('rqKeyNested')).toBe(true);
  });

  it('ignores update expressions whose argument is neither an identifier nor a member', () => {
    const symbols = symbolsFor(`
      let counter = 0;
      // The argument of this update expression is a TSAsExpression, so it is not
      // recorded as a mutated identifier/member.
      (counter as number)++;
    `);

    expect(symbols.mutableValues.has('counter')).toBe(false);
  });
});
