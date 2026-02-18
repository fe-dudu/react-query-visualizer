import type * as t from '@babel/types';
import { promises as fs } from 'node:fs';

import { scanCalls, scanImports, scanLocalBindings } from './analyzer/astScan';
import { createParseContext } from './analyzer/context';
import { collectFiles as collectFilesInternal } from './analyzer/fileCollection';
import { parseSource } from './analyzer/parser';
import { createQueryKeyResolver, resetResolverCache } from './analyzer/resolver';
import { buildSymbolIndex, normalizeAnalyzerPath } from './analyzer/symbols';
import type { AnalysisResult, QueryRecord, ScanScope } from '../types';

async function parseFiles(files: string[]): Promise<{
  parsedAsts: Map<string, t.File>;
  parseErrors: AnalysisResult['parseErrors'];
}> {
  const parsedAsts = new Map<string, t.File>();
  const parseErrors: AnalysisResult['parseErrors'] = [];

  for (const filePath of files) {
    const normalizedFile = normalizeAnalyzerPath(filePath);

    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const ast = parseSource(raw, normalizedFile);
      parsedAsts.set(normalizedFile, ast);
    } catch (error) {
      const err = error as Error;
      parseErrors.push({
        file: normalizedFile,
        message: err.message,
      });
    }
  }

  return { parsedAsts, parseErrors };
}

async function analyzeParsedFiles(parsedAsts: Map<string, t.File>, rootPath: string): Promise<QueryRecord[]> {
  const symbolIndex = buildSymbolIndex(parsedAsts);
  const records: QueryRecord[] = [];
  resetResolverCache();

  for (const [filePath, ast] of parsedAsts) {
    const context = createParseContext();
    const resolver = createQueryKeyResolver(filePath, symbolIndex, rootPath);

    scanImports(ast, context);
    scanLocalBindings(ast, context, resolver);
    scanCalls(ast, filePath, context, records, resolver);
  }

  return records;
}

export async function collectFiles(rootPath: string, scope: ScanScope): Promise<string[]> {
  return collectFilesInternal(rootPath, scope);
}

export async function runStaticAnalysis(rootPath: string, scope: ScanScope): Promise<AnalysisResult> {
  const files = await collectFiles(rootPath, scope);
  const scannedFiles = files.map((filePath) => normalizeAnalyzerPath(filePath));

  const { parsedAsts, parseErrors } = await parseFiles(files);
  const records = await analyzeParsedFiles(parsedAsts, rootPath);

  return {
    records,
    scannedFiles,
    filesScanned: files.length,
    parseErrors,
  };
}
