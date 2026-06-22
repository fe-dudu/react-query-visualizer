import type * as t from '../ast';
import { scanCalls, scanImports, scanLocalBindings } from '../astScan';
import { createParseContext } from '../context';
import { createQueryKeyResolver, resetResolverCache } from '../resolver';
import { parseSource } from '../sourceParser';
import { buildSymbolIndex, normalizeAnalyzerPath } from '../symbols';
import type { QueryRecord } from '../../../shared/contracts';
export function analyzeSources(files: Record<string, string>, rootPath = '/repo'): QueryRecord[] {
  const parsedAsts = new Map<string, t.File>();
  for (const [filePath, source] of Object.entries(files)) {
    const normalized = normalizeAnalyzerPath(filePath);
    parsedAsts.set(normalized, parseSource(source, normalized));
  }

  const symbolIndex = buildSymbolIndex(parsedAsts);
  resetResolverCache();
  const records: QueryRecord[] = [];

  for (const [filePath, ast] of parsedAsts) {
    const context = createParseContext();
    const resolver = createQueryKeyResolver(filePath, symbolIndex, rootPath);

    scanImports(ast, context);
    scanLocalBindings(ast, context, resolver, filePath);
    scanCalls(ast, filePath, context, records, resolver);
  }

  return records;
}

export function analyze(source: string, extraFiles: Record<string, string> = {}, rootPath = '/repo'): QueryRecord[] {
  return analyzeSources({ 'src/app.ts': source, ...extraFiles }, rootPath);
}
