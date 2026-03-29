import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import traverse from '@babel/traverse';
import type * as t from '@babel/types';

import { parseSource } from '../src/core/analyzer/parser';
import { inferActionQueryKey } from '../src/core/analyzer/queryKey';
import { createQueryKeyResolver, resetResolverCache } from '../src/core/analyzer/resolver';
import { buildSymbolIndex, normalizeAnalyzerPath } from '../src/core/analyzer/symbols';

test('package import queryKey factory resolves to a specific action key instead of all-query-cache', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-package-import-'));
  const utilDir = path.join(root, 'packages', 'query-test-utils', 'src');
  const appDir = path.join(root, 'packages', 'react-query', 'src', '__tests__');
  await mkdir(utilDir, { recursive: true });
  await mkdir(appDir, { recursive: true });

  const utilPackageJsonPath = path.join(root, 'packages', 'query-test-utils', 'package.json');
  const utilIndexPath = path.join(utilDir, 'index.ts');
  const utilQueryKeyPath = path.join(utilDir, 'queryKey.ts');
  const appPath = path.join(appDir, 'useQuery.test.tsx');

  await writeFile(
    utilPackageJsonPath,
    JSON.stringify(
      {
        name: '@tanstack/query-test-utils',
        main: 'src/index.ts',
        module: 'src/index.ts',
        types: 'src/index.ts',
        exports: {
          '.': {
            default: './src/index.ts',
            types: './src/index.ts',
          },
        },
      },
      null,
      2,
    ),
  );
  await writeFile(utilIndexPath, "export { queryKey } from './queryKey'\n");
  await writeFile(
    utilQueryKeyPath,
    'let queryKeyCount = 0\n' +
      'export const queryKey = (): Array<string> => {\n' +
      '  queryKeyCount++\n' +
      '  return [`query_${' +
      'queryKeyCount}`]\n' +
      '}\n',
  );
  await writeFile(
    appPath,
    "import { queryKey } from '@tanstack/query-test-utils'\nconst key = queryKey()\nqueryClient.invalidateQueries({ queryKey: key })\n",
  );

  try {
    const normalizedAppPath = normalizeAnalyzerPath(appPath);
    const parsedFiles = new Map([[normalizedAppPath, parseSource(await readFile(appPath, 'utf8'), normalizedAppPath)]]);
    const symbolIndex = buildSymbolIndex(parsedFiles);
    resetResolverCache();
    const resolver = createQueryKeyResolver(normalizedAppPath, symbolIndex, normalizeAnalyzerPath(root));
    const parsedAppFile = parsedFiles.get(normalizedAppPath);
    assert.ok(parsedAppFile);

    let actionArgs: t.CallExpression['arguments'] | undefined;
    traverse(parsedAppFile, {
      CallExpression(callPath) {
        if (
          callPath.node.callee.type === 'MemberExpression' &&
          callPath.node.callee.property.type === 'Identifier' &&
          callPath.node.callee.property.name === 'invalidateQueries'
        ) {
          actionArgs = callPath.node.arguments;
          callPath.stop();
        }
      },
    });

    assert.ok(actionArgs);
    const normalized = inferActionQueryKey('invalidateQueries', actionArgs, resolver);
    assert.notEqual(normalized.id, 'all-query-cache');
    assert.notEqual(normalized.source, 'wildcard');
    assert.equal(normalized.display, '[query_${' + 'queryKeyCount}]');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
