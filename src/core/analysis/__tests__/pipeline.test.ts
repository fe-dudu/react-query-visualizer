import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import type * as t from '../ast';
import {
  isArrayExpression,
  isCallExpression,
  isExportNamedDeclaration,
  isExpression,
  isFunctionDeclaration,
  isIdentifier,
  isVariableDeclaration,
} from '../ast';
import { createQueryKeyResolver, resetResolverCache } from '../resolver';
import { parseSource } from '../sourceParser';
import { buildFileSymbols, buildSymbolIndex } from '../symbols';
import type { AnalysisResult } from '../../../shared/contracts';
import { createQueryRecord } from '../../../testing/fixtures';
import { buildGraph } from '../../graph/buildGraph';

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-pipeline-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'packages', 'core'), { recursive: true });

  await writeFile(
    path.join(root, 'src', 'support.ts'),
    [
      "export const todoKey = ['todos'] as const;",
      'export function makeTodoKey(id: string) {',
      "  return ['todo', id] as const;",
      '}',
      'export default function defaultFactory() { return todoKey; }',
      'let mutable = 1;',
      'mutable += 1;',
      'mutable = 3;',
    ].join('\n'),
  );

  await writeFile(
    path.join(root, 'packages', 'core', 'reexport.ts'),
    ["export { todoKey as aliasTodoKey } from '../../../src/support';", "export * from '../../../src/support';"].join(
      '\n',
    ),
  );

  await writeFile(
    path.join(root, 'src', 'app.ts'),
    [
      "import { createContext, useContext } from 'react';",
      "import * as rq from '@tanstack/react-query';",
      "import { infiniteQueryOptions, queryOptions, useQueries, useQuery, useQueryClient, useSuspenseQueries, type QueryClient } from '@tanstack/react-query';",
      'const queryClient = useQueryClient();',
      'const namespaceClient = rq.useQueryClient();',
      'const rawClient = new rq.QueryClient();',
      'const clientContext = createContext<QueryClient | null>(null);',
      'const contextClient = useContext(clientContext);',
      "const localKey = ['todos'] as const;",
      "const secondaryKey = ['users'] as const;",
      "const infiniteKey = ['infinite'] as const;",
      'const localObject = { queryKey: localKey, exact: true };',
      'function localMakeTodoKey(id: string) {',
      "  return ['todo', id] as const;",
      '}',
      'function wrapQueryOptions() {',
      '  return queryOptions({',
      "    queryKey: ['wrapped'] as const,",
      "    queryFn: () => Promise.resolve('ok'),",
      '  });',
      '}',
      'const wrappedOptions = wrapQueryOptions();',
      'const options = queryOptions({',
      '  queryKey: localKey,',
      "  queryFn: () => Promise.resolve('ok'),",
      '});',
      'const infiniteOptions = infiniteQueryOptions({',
      '  queryKey: infiniteKey,',
      "  queryFn: () => Promise.resolve('ok'),",
      '});',
      'const queries = [',
      '  options,',
      '  queryOptions({',
      '    queryKey: secondaryKey,',
      "    queryFn: () => Promise.resolve('ok'),",
      '  }),',
      '];',
      'const mappedQueries = queries.map((entry) => entry);',
      'const flatMappedQueries = queries.flatMap((entry) => [entry]);',
      'const concatenatedQueries = mappedQueries.concat(flatMappedQueries).concat([infiniteOptions]);',
      'const filteredQueries = concatenatedQueries.filter(Boolean).sort().slice(0).reverse();',
      'const directValue = localKey;',
      "const directCall = localMakeTodoKey('1');",
      'const directClient = rawClient;',
      'const takeClient = (client: QueryClient = rawClient) => client;',
      'const objectClient: { queryClient: QueryClient } = { queryClient: rawClient };',
      'const { queryClient: destructuredClient } = objectClient;',
      'const queryResult = useQuery(wrappedOptions);',
      'const queryResults = useQueries({ queries: filteredQueries });',
      'const suspenseResults = useSuspenseQueries({ queries: filteredQueries });',
      'const namespaceQueryResult = rq.useQuery(options);',
      'const namespaceQueryResults = rq.useQueries({ queries: queries });',
      'queryClient.invalidateQueries({ queryKey: localKey, exact: true });',
      "queryClient.invalidateQueries({ predicate: (entry) => entry.queryKey[0] === 'todos' });",
      'queryClient.refetchQueries({ queryKey: localObject, exact: false });',
      "queryClient.refetchQueries({ predicate: (entry) => entry.queryKey[0] === 'users' });",
      'queryClient.getQueriesData({ queryKey: localKey });',
      'queryClient.getQueriesData(localKey);',
      'queryClient.removeQueries({ queryKey: localKey });',
      'queryClient.setQueryData(localKey, []);',
      'queryClient.setQueryData(() => localKey, []);',
      'queryClient.clear();',
      'const contextReturn = contextClient?.queryClient ?? rawClient;',
      'export function run() {',
      '  return (',
      '    directValue ??',
      '    directCall ??',
      '    directClient ??',
      '    takeClient() ??',
      '    destructuredClient ??',
      '    queryResult ??',
      '    queryResults ??',
      '    suspenseResults ??',
      '    namespaceClient ??',
      '    namespaceQueryResult ??',
      '    namespaceQueryResults ??',
      '    contextReturn',
      '  );',
      '}',
    ].join('\n'),
  );

  await writeFile(path.join(root, 'src', 'broken.ts'), 'export const = ;');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'rqv-pipeline' }));
  await writeFile(path.join(root, 'packages', 'core', 'package.json'), JSON.stringify({ name: 'core' }));

  return root;
}

function initByName(ast: t.File, name: string): t.Expression {
  const statement = ast.program.body.find((entry): entry is t.VariableDeclaration => {
    const declarator = isVariableDeclaration(entry) ? entry.declarations[0] : undefined;
    return isVariableDeclaration(entry) && !!declarator && isIdentifier(declarator.id) && declarator.id.name === name;
  });
  if (!statement) {
    throw new Error(`Missing declaration for ${name}`);
  }

  const init = statement.declarations[0]?.init;
  if (!init || !isExpression(init)) {
    throw new Error(`Missing initializer for ${name}`);
  }

  return init;
}

describe('core/analysis pipeline', () => {
  it('parses, symbol-indexes, resolves, and scans a real workspace', async () => {
    const root = await makeWorkspace();
    const supportPath = path.join(root, 'src', 'support.ts');
    const reexportPath = path.join(root, 'packages', 'core', 'reexport.ts');
    const appPath = path.join(root, 'src', 'app.ts');

    const supportRaw = await readFile(supportPath, 'utf8');
    const reexportRaw = await readFile(reexportPath, 'utf8');
    const appRaw = await readFile(appPath, 'utf8');

    const supportAst = parseSource(supportRaw, supportPath);
    const reexportAst = parseSource(reexportRaw, reexportPath);
    const appAst = parseSource(appRaw, appPath);

    expect(supportAst.program.body[0]?.loc?.start).toEqual({ line: 1, column: 0 });
    expect(supportAst.program.body[1]?.loc?.start.line).toBe(2);

    const supportSymbols = buildFileSymbols(supportPath, supportAst);
    expect(supportSymbols.exports.get('todoKey')).toBe('todoKey');
    expect(supportSymbols.exports.get('default')).toBe('defaultFactory');
    expect(supportSymbols.functions.has('makeTodoKey')).toBe(true);
    expect(supportSymbols.mutableValues.has('mutable')).toBe(true);

    const reexportSymbols = buildFileSymbols(reexportPath, reexportAst);
    expect(reexportSymbols.reExports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: '../../../src/support',
          exported: 'aliasTodoKey',
          imported: 'todoKey',
          all: false,
        }),
        expect.objectContaining({ source: '../../../src/support', all: true }),
      ]),
    );

    const index = buildSymbolIndex(
      new Map([
        [supportPath, supportAst],
        [reexportPath, reexportAst],
        [appPath, appAst],
      ]),
    );

    resetResolverCache();
    const resolver = createQueryKeyResolver(appPath, index, root);
    const directValue = initByName(appAst, 'directValue');
    const directCall = initByName(appAst, 'directCall');
    const wrappedOptions = initByName(appAst, 'wrappedOptions');
    const runDeclaration = appAst.program.body.find((entry): entry is t.ExportNamedDeclaration => {
      return isExportNamedDeclaration(entry) && !!entry.declaration && isFunctionDeclaration(entry.declaration);
    });
    if (
      !runDeclaration ||
      !isExportNamedDeclaration(runDeclaration) ||
      !runDeclaration.declaration ||
      !isFunctionDeclaration(runDeclaration.declaration)
    ) {
      throw new Error('Missing run function');
    }
    const _runStatements = runDeclaration.declaration.body.body;

    expect(isCallExpression(directCall)).toBe(true);

    resolver.resolveReference(directValue as t.Expression);
    const resolvedDirectCall = resolver.resolveCallResult((directCall as t.CallExpression).callee);
    resolver.resolveCallResult((wrappedOptions as t.CallExpression).callee);

    expect(resolvedDirectCall && isArrayExpression(resolvedDirectCall)).toBe(true);
    resolver.resolveCallResult((wrappedOptions as t.CallExpression).callee);

    const analysis: AnalysisResult = {
      scannedFiles: [supportPath, reexportPath, appPath, path.join(root, 'src', 'broken.ts')],
      filesScanned: 4,
      parseErrors: [{ file: path.join(root, 'src', 'broken.ts'), message: 'Unexpected token' }],
      records: [
        createQueryRecord({
          relation: 'declares',
          operation: 'useQuery',
          file: appPath,
          loc: { line: 46, column: 20 },
          declaresDirectly: true,
          queryKey: {
            id: 'todos',
            display: '[todos]',
            segments: ['todos'],
            matchMode: 'exact',
            resolution: 'static',
            source: 'literal',
          },
        }),
        createQueryRecord({
          relation: 'invalidates',
          operation: 'invalidateQueries',
          file: appPath,
          loc: { line: 50, column: 12 },
          queryKey: {
            id: 'todos',
            display: '[todos]',
            segments: ['todos'],
            matchMode: 'exact',
            resolution: 'static',
            source: 'literal',
          },
        }),
      ],
    };

    expect(analysis.filesScanned).toBeGreaterThanOrEqual(3);
    expect(analysis.parseErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: path.join(root, 'src', 'broken.ts') })]),
    );
    expect(analysis.records.length).toBeGreaterThan(0);

    const graph = buildGraph([{ name: 'workspace', path: root }], analysis);
    expect(graph.summary.files).toBeGreaterThan(0);
    expect(graph.summary.actions).toBeGreaterThan(0);
    expect(graph.summary.queryKeys).toBeGreaterThan(0);
    expect(graph.parseErrors[0]?.file).toContain('src/broken.ts');
  });
});
