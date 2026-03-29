import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseSource } from '../src/core/analyzer/parser';
import { scanCalls, scanImports, scanLocalBindings } from '../src/core/analyzer/astScan';
import { createParseContext } from '../src/core/analyzer/context';
import { createQueryKeyResolver, resetResolverCache } from '../src/core/analyzer/resolver';
import { buildSymbolIndex, normalizeAnalyzerPath } from '../src/core/analyzer/symbols';
import type { QueryRecord } from '../src/types';

test('refetch calls use the query key from the same scoped hook binding', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-refetch-scope-'));
  const filePath = path.join(root, 'sample.test.tsx');
  await mkdir(root, { recursive: true });
  await writeFile(
    filePath,
    [
      "import { test } from 'vitest'",
      "import { useInfiniteQuery } from '@tanstack/react-query'",
      "test('a', () => {",
      "  const state = useInfiniteQuery({ queryKey: ['first'], queryFn: async () => 1, initialPageParam: 0 })",
      '  state.refetch()',
      '})',
      "test('b', () => {",
      "  const state = useInfiniteQuery({ queryKey: ['second'], queryFn: async () => 2, initialPageParam: 0 })",
      '  state.refetch()',
      '})',
      '',
    ].join('\n'),
  );

  try {
    const normalizedFile = normalizeAnalyzerPath(filePath);
    const ast = parseSource(await readFile(filePath, 'utf8'), normalizedFile);
    const parsedFiles = new Map([[normalizedFile, ast]]);
    const index = buildSymbolIndex(parsedFiles);
    resetResolverCache();
    const resolver = createQueryKeyResolver(normalizedFile, index, normalizeAnalyzerPath(root));
    const context = createParseContext();
    const records: QueryRecord[] = [];

    scanImports(ast, context);
    scanLocalBindings(ast, context, resolver, normalizedFile);
    scanCalls(ast, normalizedFile, context, records, resolver);

    const refetches = records.filter((record) => record.operation === 'refetch');
    assert.deepEqual(
      refetches.map((record) => record.queryKey.display),
      ['[first]', '[second]'],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
