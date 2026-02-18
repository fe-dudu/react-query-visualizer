import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as t from '@babel/types';

import type { ImportBinding, QueryKeyResolver, SymbolIndex } from './types';
import { extractFunctionReturnExpression, normalizeAnalyzerPath, unwrapExpression } from './symbols';

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
const MAX_DEPTH = 24;
const NODE_REQUIRE = createRequire(__filename);

interface ResolvedPathAliases {
  baseUrlAbs?: string;
  paths: Map<string, string[]>;
}

interface PathAliasEntry {
  pattern: string;
  targets: string[];
}

const nearestConfigCache = new Map<string, string | null>();
const parsedAliasConfigCache = new Map<string, ResolvedPathAliases>();
const aliasEntriesCache = new Map<string, PathAliasEntry[]>();

export function resetResolverCache(): void {
  nearestConfigCache.clear();
  parsedAliasConfigCache.clear();
  aliasEntriesCache.clear();
}

function commonPathPrefixLength(left: string, right: string): number {
  const leftSegments = left.split(path.sep).filter(Boolean);
  const rightSegments = right.split(path.sep).filter(Boolean);
  const limit = Math.min(leftSegments.length, rightSegments.length);
  let count = 0;

  while (count < limit && leftSegments[count] === rightSegments[count]) {
    count += 1;
  }

  return count;
}

function isLikelyQueryKeyFactoryIdentifier(name: string): boolean {
  if (!name) {
    return false;
  }

  const normalized = name.toLowerCase();
  if (normalized.includes('querykey')) {
    return true;
  }

  return normalized.includes('rqkey');
}

function stripJsonComments(input: string): string {
  let output = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function stripTrailingCommas(input: string): string {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char !== ',') {
      output += char;
      continue;
    }

    let lookahead = index + 1;
    while (lookahead < input.length && /\s/.test(input[lookahead])) {
      lookahead += 1;
    }

    const next = input[lookahead];
    if (next === '}' || next === ']') {
      continue;
    }

    output += char;
  }

  return output;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const clean = stripTrailingCommas(stripJsonComments(text)).trim();
  if (!clean) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(clean);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const output: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      output.push(item);
    }
  }

  return output.length > 0 ? output : undefined;
}

function resolveExtendsConfigPath(configDir: string, extendsValue: string): string | undefined {
  const value = extendsValue.trim();
  if (!value) {
    return undefined;
  }

  const isRelative = value.startsWith('./') || value.startsWith('../');
  const isAbsolute = path.isAbsolute(value);
  if (isRelative || isAbsolute) {
    const base = isAbsolute ? value : path.resolve(configDir, value);
    const candidates = base.endsWith('.json') ? [base] : [base, `${base}.json`];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return normalizeAnalyzerPath(candidate);
      }
    }
    return undefined;
  }

  const packageCandidates = [value, `${value}.json`, `${value}/tsconfig.json`];
  for (const candidate of packageCandidates) {
    try {
      const resolved = NODE_REQUIRE.resolve(candidate, { paths: [configDir] });
      return normalizeAnalyzerPath(resolved);
    } catch {
      // try next package candidate
    }
  }

  return undefined;
}

function mergePathAliases(configPath: string, seen: Set<string>): ResolvedPathAliases {
  const normalizedConfig = normalizeAnalyzerPath(configPath);
  const cached = parsedAliasConfigCache.get(normalizedConfig);
  if (cached) {
    return cached;
  }

  if (seen.has(normalizedConfig)) {
    return { paths: new Map() };
  }
  seen.add(normalizedConfig);

  let parentResolved: ResolvedPathAliases = { paths: new Map() };
  let rawConfig: Record<string, unknown> | undefined;

  try {
    rawConfig = parseJsonObject(readFileSync(normalizedConfig, 'utf8'));
  } catch {
    rawConfig = undefined;
  }

  const compilerOptions = asRecord(rawConfig?.compilerOptions);
  const extendsValue = typeof rawConfig?.extends === 'string' ? rawConfig.extends : undefined;
  if (extendsValue) {
    const extendedPath = resolveExtendsConfigPath(path.dirname(normalizedConfig), extendsValue);
    if (extendedPath) {
      parentResolved = mergePathAliases(extendedPath, seen);
    }
  }

  const merged: ResolvedPathAliases = {
    baseUrlAbs: parentResolved.baseUrlAbs,
    paths: new Map(parentResolved.paths),
  };

  if (typeof compilerOptions?.baseUrl === 'string') {
    merged.baseUrlAbs = normalizeAnalyzerPath(path.resolve(path.dirname(normalizedConfig), compilerOptions.baseUrl));
  }

  const rawPaths = asRecord(compilerOptions?.paths);
  if (rawPaths) {
    const basePath = merged.baseUrlAbs ?? path.dirname(normalizedConfig);
    for (const [pattern, value] of Object.entries(rawPaths)) {
      if (!pattern) {
        continue;
      }

      const targets = asStringArray(value);
      if (!targets || targets.length === 0) {
        continue;
      }

      const absoluteTargets = targets.map((target) => {
        if (path.isAbsolute(target)) {
          return normalizeAnalyzerPath(target);
        }
        return normalizeAnalyzerPath(path.resolve(basePath, target));
      });
      merged.paths.set(pattern, absoluteTargets);
    }
  }

  parsedAliasConfigCache.set(normalizedConfig, merged);
  return merged;
}

function findNearestConfigFile(fromFile: string, workspaceRoot: string): string | undefined {
  const normalizedFile = normalizeAnalyzerPath(fromFile);
  const normalizedRoot = normalizeAnalyzerPath(workspaceRoot);
  const startDir = path.dirname(normalizedFile);
  const cacheKey = `${normalizedRoot}::${startDir}`;
  const cached = nearestConfigCache.get(cacheKey);
  if (cached !== undefined) {
    return cached ?? undefined;
  }

  let cursor = startDir;
  while (true) {
    const tsconfigPath = path.join(cursor, 'tsconfig.json');
    if (existsSync(tsconfigPath)) {
      const resolved = normalizeAnalyzerPath(tsconfigPath);
      nearestConfigCache.set(cacheKey, resolved);
      return resolved;
    }

    const jsconfigPath = path.join(cursor, 'jsconfig.json');
    if (existsSync(jsconfigPath)) {
      const resolved = normalizeAnalyzerPath(jsconfigPath);
      nearestConfigCache.set(cacheKey, resolved);
      return resolved;
    }

    if (cursor === normalizedRoot) {
      break;
    }

    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  nearestConfigCache.set(cacheKey, null);
  return undefined;
}

function getPathAliasEntries(fromFile: string, workspaceRoot: string): PathAliasEntry[] {
  const configPath = findNearestConfigFile(fromFile, workspaceRoot);
  if (!configPath) {
    return [];
  }

  const cached = aliasEntriesCache.get(configPath);
  if (cached) {
    return cached;
  }

  const resolved = mergePathAliases(configPath, new Set());
  const entries = [...resolved.paths.entries()]
    .map(([pattern, targets]) => ({ pattern, targets }))
    .sort((left, right) => {
      const leftHasWildcard = left.pattern.includes('*');
      const rightHasWildcard = right.pattern.includes('*');
      if (leftHasWildcard !== rightHasWildcard) {
        return leftHasWildcard ? 1 : -1;
      }

      if (left.pattern.length !== right.pattern.length) {
        return right.pattern.length - left.pattern.length;
      }

      return left.pattern.localeCompare(right.pattern);
    });

  aliasEntriesCache.set(configPath, entries);
  return entries;
}

function aliasCapture(pattern: string, source: string): string | undefined {
  const starIndex = pattern.indexOf('*');
  if (starIndex === -1) {
    return pattern === source ? '' : undefined;
  }

  const prefix = pattern.slice(0, starIndex);
  const suffix = pattern.slice(starIndex + 1);
  if (!source.startsWith(prefix) || !source.endsWith(suffix)) {
    return undefined;
  }

  return source.slice(prefix.length, source.length - suffix.length);
}

function propertyNameFromMemberExpression(
  node: t.MemberExpression,
  getExpressionValue: (input: t.Expression) => string | undefined,
): string | undefined {
  if (!node.computed && t.isIdentifier(node.property)) {
    return node.property.name;
  }

  if (t.isStringLiteral(node.property)) {
    return node.property.value;
  }

  if (t.isNumericLiteral(node.property)) {
    return String(node.property.value);
  }

  if (t.isExpression(node.property)) {
    return getExpressionValue(node.property);
  }

  return undefined;
}

function objectPropertyValue(objectNode: t.ObjectExpression, propertyName: string): t.Expression | undefined {
  for (const property of objectNode.properties) {
    if (!t.isObjectProperty(property)) {
      continue;
    }

    const key = property.key;
    let keyName: string | undefined;
    if (t.isIdentifier(key)) {
      keyName = key.name;
    } else if (t.isStringLiteral(key)) {
      keyName = key.value;
    }
    if (!keyName || keyName !== propertyName || !t.isExpression(property.value)) {
      continue;
    }

    return unwrapExpression(property.value);
  }

  return undefined;
}

function queryKeyPropertyFromCall(node: t.CallExpression): t.Expression | undefined {
  const firstArg = node.arguments[0];
  if (!firstArg || !t.isExpression(firstArg)) {
    return undefined;
  }

  const firstExpression = unwrapExpression(firstArg);
  if (!t.isObjectExpression(firstExpression)) {
    return undefined;
  }

  return objectPropertyValue(firstExpression, 'queryKey');
}

function firstExpressionArgument(args: t.CallExpression['arguments']): t.Expression | undefined {
  const first = args[0];
  if (!first || !t.isExpression(first)) {
    return undefined;
  }

  return unwrapExpression(first);
}

function isObjectFreezeCall(callee: t.CallExpression['callee']): boolean {
  return (
    t.isMemberExpression(callee) &&
    !callee.computed &&
    t.isIdentifier(callee.object) &&
    callee.object.name === 'Object' &&
    t.isIdentifier(callee.property) &&
    callee.property.name === 'freeze'
  );
}

function isIdentityWrapperCall(callee: t.CallExpression['callee']): boolean {
  if (t.isIdentifier(callee) && (callee.name === 'queryOptions' || callee.name === 'infiniteQueryOptions')) {
    return true;
  }

  if (
    t.isMemberExpression(callee) &&
    !callee.computed &&
    t.isIdentifier(callee.property) &&
    (callee.property.name === 'queryOptions' || callee.property.name === 'infiniteQueryOptions')
  ) {
    return true;
  }

  return isObjectFreezeCall(callee);
}

function resolveModuleFile(
  fromFile: string,
  source: string,
  fileSet: Set<string>,
  workspaceRoot: string,
): string | undefined {
  const isRelative = source.startsWith('./') || source.startsWith('../');
  const isAbsolute = path.isAbsolute(source);
  if (!isRelative && !isAbsolute) {
    const aliasEntries = getPathAliasEntries(fromFile, workspaceRoot);
    const matches: string[] = [];
    for (const entry of aliasEntries) {
      const captured = aliasCapture(entry.pattern, source);
      if (captured === undefined) {
        continue;
      }

      for (const targetPattern of entry.targets) {
        const target = targetPattern.includes('*') ? targetPattern.replace(/\*/g, captured) : targetPattern;
        const hasExplicitExtension = RESOLVE_EXTENSIONS.some((ext) => target.endsWith(ext));
        const candidates = hasExplicitExtension
          ? [target]
          : [
              ...RESOLVE_EXTENSIONS.map((ext) => `${target}${ext}`),
              ...RESOLVE_EXTENSIONS.map((ext) => path.join(target, `index${ext}`)),
            ];

        for (const candidate of candidates) {
          const normalized = normalizeAnalyzerPath(candidate);
          if (fileSet.has(normalized)) {
            matches.push(normalized);
          }
        }
      }
    }

    if (matches.length === 0) {
      return undefined;
    }

    const fromDir = path.dirname(normalizeAnalyzerPath(fromFile));
    const uniqueMatches = [...new Set(matches)].sort((a, b) => {
      const aDir = path.dirname(a);
      const bDir = path.dirname(b);

      const commonA = commonPathPrefixLength(fromDir, aDir);
      const commonB = commonPathPrefixLength(fromDir, bDir);
      if (commonA !== commonB) {
        return commonB - commonA;
      }

      const relativeA = path.relative(fromDir, aDir);
      const relativeB = path.relative(fromDir, bDir);

      const upA = relativeA.split(path.sep).filter((segment) => segment === '..').length;
      const upB = relativeB.split(path.sep).filter((segment) => segment === '..').length;
      if (upA !== upB) {
        return upA - upB;
      }

      const distanceA = relativeA.split(path.sep).filter(Boolean).length;
      const distanceB = relativeB.split(path.sep).filter(Boolean).length;
      if (distanceA !== distanceB) {
        return distanceA - distanceB;
      }

      if (a.length !== b.length) {
        return a.length - b.length;
      }

      return a.localeCompare(b);
    });

    return uniqueMatches[0];
  }

  const base = isAbsolute ? source : path.resolve(path.dirname(fromFile), source);
  const candidates: string[] = [];
  const hasExplicitExtension = RESOLVE_EXTENSIONS.some((ext) => source.endsWith(ext));

  if (hasExplicitExtension) {
    candidates.push(base);
  } else {
    for (const ext of RESOLVE_EXTENSIONS) {
      candidates.push(`${base}${ext}`);
    }

    for (const ext of RESOLVE_EXTENSIONS) {
      candidates.push(path.join(base, `index${ext}`));
    }
  }

  for (const candidate of candidates) {
    const normalized = normalizeAnalyzerPath(candidate);
    if (fileSet.has(normalized)) {
      return normalized;
    }
  }

  return undefined;
}

function expressionToLiteralString(
  filePath: string,
  expression: t.Expression,
  resolveReferenceInternal: (
    file: string,
    node: t.Expression,
    depth: number,
    seen: Set<string>,
  ) => t.Expression | undefined,
  depth: number,
  seen: Set<string>,
): string | undefined {
  const resolved = resolveReferenceInternal(filePath, expression, depth + 1, seen) ?? unwrapExpression(expression);
  if (t.isStringLiteral(resolved)) {
    return resolved.value;
  }

  if (t.isNumericLiteral(resolved) || t.isBooleanLiteral(resolved)) {
    return String(resolved.value);
  }

  return undefined;
}

export function createQueryKeyResolver(filePath: string, index: SymbolIndex, workspaceRoot: string): QueryKeyResolver {
  const entryFile = normalizeAnalyzerPath(filePath);
  const normalizedWorkspaceRoot = normalizeAnalyzerPath(workspaceRoot);
  const expressionOrigins = new WeakMap<t.Node, string>();

  const markNodeOrigin = (node: t.Node, originFile: string): void => {
    const stack: t.Node[] = [node];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || expressionOrigins.has(current)) {
        continue;
      }

      expressionOrigins.set(current, originFile);

      const visitorKeys = t.VISITOR_KEYS[current.type];
      if (!visitorKeys) {
        continue;
      }

      for (const key of visitorKeys) {
        const value = (current as unknown as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
          for (const nested of value) {
            if (nested && typeof nested === 'object' && 'type' in nested) {
              stack.push(nested as t.Node);
            }
          }
          continue;
        }

        if (value && typeof value === 'object' && 'type' in value) {
          stack.push(value as t.Node);
        }
      }
    }
  };

  const markExpressionOrigin = (expression: t.Expression | undefined, originFile: string): t.Expression | undefined => {
    if (expression) {
      markNodeOrigin(expression, originFile);
    }

    return expression;
  };

  const originForNode = (node: t.Node, fallbackFile: string): string => {
    return expressionOrigins.get(node) ?? fallbackFile;
  };

  const resolveExportValue = (
    targetFile: string,
    exportName: string,
    depth: number,
    seen: Set<string>,
  ): t.Expression | undefined => {
    if (depth > MAX_DEPTH) {
      return undefined;
    }

    const key = `exp-value:${targetFile}:${exportName}`;
    if (seen.has(key)) {
      return undefined;
    }
    seen.add(key);

    const symbols = index.files.get(targetFile);
    if (!symbols) {
      return undefined;
    }

    const localName = symbols.exports.get(exportName);
    if (localName) {
      return resolveLocalValue(targetFile, localName, depth + 1, seen);
    }

    for (const reExport of symbols.reExports) {
      if (reExport.all) {
        const nestedFile = resolveModuleFile(targetFile, reExport.source, index.fileSet, normalizedWorkspaceRoot);
        if (!nestedFile) {
          continue;
        }

        const value = resolveExportValue(nestedFile, exportName, depth + 1, seen);
        if (value) {
          return value;
        }

        continue;
      }

      if (reExport.exported !== exportName) {
        continue;
      }

      const nestedFile = resolveModuleFile(targetFile, reExport.source, index.fileSet, normalizedWorkspaceRoot);
      if (!nestedFile) {
        continue;
      }

      const nestedName = reExport.imported ?? exportName;
      const value = resolveExportValue(nestedFile, nestedName, depth + 1, seen);
      if (value) {
        return value;
      }
    }

    return undefined;
  };

  const resolveExportFunctionReturn = (
    targetFile: string,
    exportName: string,
    depth: number,
    seen: Set<string>,
  ): t.Expression | undefined => {
    if (depth > MAX_DEPTH) {
      return undefined;
    }

    const key = `exp-fn:${targetFile}:${exportName}`;
    if (seen.has(key)) {
      return undefined;
    }
    seen.add(key);

    const symbols = index.files.get(targetFile);
    if (!symbols) {
      return undefined;
    }

    const localName = symbols.exports.get(exportName);
    if (localName) {
      return resolveLocalFunctionReturn(targetFile, localName, depth + 1, seen);
    }

    for (const reExport of symbols.reExports) {
      if (reExport.all) {
        const nestedFile = resolveModuleFile(targetFile, reExport.source, index.fileSet, normalizedWorkspaceRoot);
        if (!nestedFile) {
          continue;
        }

        const value = resolveExportFunctionReturn(nestedFile, exportName, depth + 1, seen);
        if (value) {
          return value;
        }

        continue;
      }

      if (reExport.exported !== exportName) {
        continue;
      }

      const nestedFile = resolveModuleFile(targetFile, reExport.source, index.fileSet, normalizedWorkspaceRoot);
      if (!nestedFile) {
        continue;
      }

      const nestedName = reExport.imported ?? exportName;
      const value = resolveExportFunctionReturn(nestedFile, nestedName, depth + 1, seen);
      if (value) {
        return value;
      }
    }

    return undefined;
  };

  const resolveImportedValue = (
    fromFile: string,
    binding: ImportBinding,
    depth: number,
    seen: Set<string>,
  ): t.Expression | undefined => {
    if (binding.kind === 'namespace') {
      return undefined;
    }

    const targetFile = resolveModuleFile(fromFile, binding.source, index.fileSet, normalizedWorkspaceRoot);
    if (!targetFile) {
      return undefined;
    }

    const exportName = binding.kind === 'default' ? 'default' : (binding.imported ?? 'default');
    return resolveExportValue(targetFile, exportName, depth + 1, seen);
  };

  const resolveImportedFunctionReturn = (
    fromFile: string,
    binding: ImportBinding,
    depth: number,
    seen: Set<string>,
  ): t.Expression | undefined => {
    if (binding.kind === 'namespace') {
      return undefined;
    }

    const targetFile = resolveModuleFile(fromFile, binding.source, index.fileSet, normalizedWorkspaceRoot);
    if (!targetFile) {
      return undefined;
    }

    const exportName = binding.kind === 'default' ? 'default' : (binding.imported ?? 'default');
    return resolveExportFunctionReturn(targetFile, exportName, depth + 1, seen);
  };

  const resolveNamespaceMember = (
    fromFile: string,
    namespaceName: string,
    memberName: string,
    depth: number,
    seen: Set<string>,
  ): t.Expression | undefined => {
    const symbols = index.files.get(fromFile);
    const binding = symbols?.imports.get(namespaceName);
    if (!binding || binding.kind !== 'namespace') {
      return undefined;
    }

    const targetFile = resolveModuleFile(fromFile, binding.source, index.fileSet, normalizedWorkspaceRoot);
    if (!targetFile) {
      return undefined;
    }

    return resolveExportValue(targetFile, memberName, depth + 1, seen);
  };

  const resolveLocalValue = (
    fromFile: string,
    localName: string,
    depth: number,
    seen: Set<string>,
  ): t.Expression | undefined => {
    if (depth > MAX_DEPTH) {
      return undefined;
    }

    const key = `local-value:${fromFile}:${localName}`;
    if (seen.has(key)) {
      return undefined;
    }
    seen.add(key);

    const symbols = index.files.get(fromFile);
    if (!symbols) {
      return undefined;
    }

    const localValue = symbols.values.get(localName);
    if (localValue) {
      if (t.isIdentifier(localValue) && localValue.name !== localName) {
        const resolvedAlias = resolveLocalValue(fromFile, localValue.name, depth + 1, seen) ?? localValue;
        return markExpressionOrigin(resolvedAlias, fromFile);
      }

      return markExpressionOrigin(localValue, fromFile);
    }

    const localFunctionReturn = symbols.functions.get(localName);
    if (localFunctionReturn) {
      return markExpressionOrigin(localFunctionReturn, fromFile);
    }

    const importBinding = symbols.imports.get(localName);
    if (!importBinding) {
      return undefined;
    }

    return resolveImportedValue(fromFile, importBinding, depth + 1, seen);
  };

  const resolveLocalFunctionReturn = (
    fromFile: string,
    localName: string,
    depth: number,
    seen: Set<string>,
  ): t.Expression | undefined => {
    if (depth > MAX_DEPTH) {
      return undefined;
    }

    const key = `local-fn:${fromFile}:${localName}`;
    if (seen.has(key)) {
      return undefined;
    }
    seen.add(key);

    const symbols = index.files.get(fromFile);
    if (!symbols) {
      return undefined;
    }

    const localFunctionReturn = symbols.functions.get(localName);
    if (localFunctionReturn) {
      return markExpressionOrigin(localFunctionReturn, fromFile);
    }

    const localValue = symbols.values.get(localName);
    if (localValue) {
      if (t.isIdentifier(localValue) && localValue.name !== localName) {
        return resolveLocalFunctionReturn(fromFile, localValue.name, depth + 1, seen);
      }

      if (t.isFunctionExpression(localValue) || t.isArrowFunctionExpression(localValue)) {
        const returned = extractFunctionReturnExpression(localValue);
        return markExpressionOrigin(returned, fromFile);
      }

      return undefined;
    }

    const importBinding = symbols.imports.get(localName);
    if (!importBinding) {
      return undefined;
    }

    return resolveImportedFunctionReturn(fromFile, importBinding, depth + 1, seen);
  };

  const resolveWorkspaceFunctionReturnByName = (fromFile: string, functionName: string): t.Expression | undefined => {
    if (!isLikelyQueryKeyFactoryIdentifier(functionName)) {
      return undefined;
    }

    const candidates: Array<{ filePath: string; expression: t.Expression; score: number }> = [];

    for (const [candidateFile, symbols] of index.files) {
      const fromFunctions = symbols.functions.get(functionName);
      if (fromFunctions) {
        candidates.push({
          filePath: candidateFile,
          expression: fromFunctions,
          score: commonPathPrefixLength(fromFile, candidateFile),
        });
        continue;
      }

      const fromValues = symbols.values.get(functionName);
      if (!fromValues) {
        continue;
      }

      if (!t.isFunctionExpression(fromValues) && !t.isArrowFunctionExpression(fromValues)) {
        continue;
      }

      const returned = extractFunctionReturnExpression(fromValues);
      if (!returned) {
        continue;
      }

      candidates.push({
        filePath: candidateFile,
        expression: returned,
        score: commonPathPrefixLength(fromFile, candidateFile),
      });
    }

    if (candidates.length === 0) {
      return undefined;
    }

    candidates.sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));
    const [best, second] = candidates;
    if (!best) {
      return undefined;
    }

    if (second && second.score === best.score && second.filePath !== best.filePath) {
      return undefined;
    }

    return markExpressionOrigin(best.expression, best.filePath);
  };

  const resolveObjectPropertyValue = (
    fromFile: string,
    objectNode: t.ObjectExpression,
    propertyName: string,
    depth: number,
    seen: Set<string>,
  ): t.Expression | undefined => {
    if (depth > MAX_DEPTH) {
      return undefined;
    }

    for (let index = objectNode.properties.length - 1; index >= 0; index -= 1) {
      const property = objectNode.properties[index];
      if (!property) {
        continue;
      }

      if (t.isObjectProperty(property)) {
        const key = property.key;
        let keyName: string | undefined;
        if (t.isIdentifier(key)) {
          keyName = key.name;
        } else if (t.isStringLiteral(key)) {
          keyName = key.value;
        } else if (t.isNumericLiteral(key)) {
          keyName = String(key.value);
        }

        if (keyName === propertyName && t.isExpression(property.value)) {
          return markExpressionOrigin(unwrapExpression(property.value), fromFile);
        }
        continue;
      }

      if (!t.isSpreadElement(property) || !t.isExpression(property.argument)) {
        continue;
      }

      const spreadValue =
        resolveReferenceInternal(fromFile, property.argument, depth + 1, seen) ?? unwrapExpression(property.argument);
      if (!t.isObjectExpression(spreadValue)) {
        continue;
      }

      const nested = resolveObjectPropertyValue(fromFile, spreadValue, propertyName, depth + 1, seen);
      if (nested) {
        return nested;
      }
    }

    return undefined;
  };

  const resolveReferenceInternal = (
    fromFile: string,
    expression: t.Expression,
    depth: number,
    seen: Set<string>,
  ): t.Expression | undefined => {
    if (depth > MAX_DEPTH) {
      return undefined;
    }

    const node = unwrapExpression(expression);

    if (t.isIdentifier(node)) {
      return resolveLocalValue(fromFile, node.name, depth + 1, seen);
    }

    if (!t.isMemberExpression(node)) {
      return undefined;
    }

    if (t.isIdentifier(node.object)) {
      const propertyName = propertyNameFromMemberExpression(node, (input) =>
        expressionToLiteralString(fromFile, input, resolveReferenceInternal, depth, seen),
      );
      if (propertyName) {
        const namespaceValue = resolveNamespaceMember(fromFile, node.object.name, propertyName, depth + 1, seen);
        if (namespaceValue) {
          return namespaceValue;
        }
      }
    }

    if (!t.isExpression(node.object)) {
      return undefined;
    }

    const resolvedObject =
      resolveReferenceInternal(fromFile, node.object, depth + 1, seen) ?? unwrapExpression(node.object);
    const propertyName = propertyNameFromMemberExpression(node, (input) =>
      expressionToLiteralString(fromFile, input, resolveReferenceInternal, depth, seen),
    );

    if (!propertyName) {
      return undefined;
    }

    if (t.isObjectExpression(resolvedObject)) {
      return resolveObjectPropertyValue(fromFile, resolvedObject, propertyName, depth + 1, seen);
    }

    if (t.isCallExpression(resolvedObject)) {
      if (propertyName === 'queryKey') {
        const fromCallArg = queryKeyPropertyFromCall(resolvedObject);
        if (fromCallArg) {
          return fromCallArg;
        }
      }

      const wrappedArg = firstExpressionArgument(resolvedObject.arguments);
      if (
        wrappedArg &&
        (isIdentityWrapperCall(resolvedObject.callee) ||
          (resolvedObject.arguments.length === 1 &&
            (t.isObjectExpression(wrappedArg) || t.isArrayExpression(wrappedArg))))
      ) {
        const resolvedWrappedArg = resolveReferenceInternal(fromFile, wrappedArg, depth + 1, seen) ?? wrappedArg;
        if (t.isObjectExpression(resolvedWrappedArg)) {
          return resolveObjectPropertyValue(fromFile, resolvedWrappedArg, propertyName, depth + 1, seen);
        }

        if (t.isArrayExpression(resolvedWrappedArg)) {
          const indexValue = Number.parseInt(propertyName, 10);
          if (!Number.isFinite(indexValue) || indexValue < 0 || indexValue >= resolvedWrappedArg.elements.length) {
            return undefined;
          }

          const element = resolvedWrappedArg.elements[indexValue];
          if (!element || !t.isExpression(element)) {
            return undefined;
          }

          return markExpressionOrigin(unwrapExpression(element), fromFile);
        }
      }

      const nestedCallResult = resolveCallResultInternal(fromFile, resolvedObject.callee, depth + 1, seen);
      if (nestedCallResult) {
        if (t.isObjectExpression(nestedCallResult)) {
          return resolveObjectPropertyValue(fromFile, nestedCallResult, propertyName, depth + 1, seen);
        }

        if (t.isCallExpression(nestedCallResult)) {
          if (propertyName === 'queryKey') {
            const nestedQueryKey = queryKeyPropertyFromCall(nestedCallResult);
            if (nestedQueryKey) {
              return nestedQueryKey;
            }
          }

          const nestedWrappedArg = firstExpressionArgument(nestedCallResult.arguments);
          if (
            nestedWrappedArg &&
            (isIdentityWrapperCall(nestedCallResult.callee) ||
              (nestedCallResult.arguments.length === 1 &&
                (t.isObjectExpression(nestedWrappedArg) || t.isArrayExpression(nestedWrappedArg))))
          ) {
            const resolvedNestedWrappedArg =
              resolveReferenceInternal(fromFile, nestedWrappedArg, depth + 1, seen) ?? nestedWrappedArg;
            if (t.isObjectExpression(resolvedNestedWrappedArg)) {
              return resolveObjectPropertyValue(fromFile, resolvedNestedWrappedArg, propertyName, depth + 1, seen);
            }

            if (t.isArrayExpression(resolvedNestedWrappedArg)) {
              const indexValue = Number.parseInt(propertyName, 10);
              if (
                !Number.isFinite(indexValue) ||
                indexValue < 0 ||
                indexValue >= resolvedNestedWrappedArg.elements.length
              ) {
                return undefined;
              }

              const element = resolvedNestedWrappedArg.elements[indexValue];
              if (!element || !t.isExpression(element)) {
                return undefined;
              }

              return markExpressionOrigin(unwrapExpression(element), fromFile);
            }
          }
        }
      }
    }

    if (t.isArrayExpression(resolvedObject)) {
      const indexValue = Number.parseInt(propertyName, 10);
      if (!Number.isFinite(indexValue) || indexValue < 0 || indexValue >= resolvedObject.elements.length) {
        return undefined;
      }

      const element = resolvedObject.elements[indexValue];
      if (!element || !t.isExpression(element)) {
        return undefined;
      }

      return markExpressionOrigin(unwrapExpression(element), fromFile);
    }

    return undefined;
  };

  const resolveCallResultInternal = (
    fromFile: string,
    callee: t.CallExpression['callee'],
    depth: number,
    seen: Set<string>,
  ): t.Expression | undefined => {
    if (depth > MAX_DEPTH) {
      return undefined;
    }

    if (t.isIdentifier(callee)) {
      const localFunctionReturn = resolveLocalFunctionReturn(fromFile, callee.name, depth + 1, seen);
      if (localFunctionReturn) {
        return localFunctionReturn;
      }

      const localValue = resolveLocalValue(fromFile, callee.name, depth + 1, seen);
      if (!localValue) {
        return resolveWorkspaceFunctionReturnByName(fromFile, callee.name);
      }

      if (t.isFunctionExpression(localValue) || t.isArrowFunctionExpression(localValue)) {
        return extractFunctionReturnExpression(localValue);
      }

      return localValue;
    }

    if (!t.isMemberExpression(callee)) {
      return undefined;
    }

    if (t.isIdentifier(callee.object) && !callee.computed && t.isIdentifier(callee.property)) {
      const namespaceFunction = resolveNamespaceMember(
        fromFile,
        callee.object.name,
        callee.property.name,
        depth + 1,
        seen,
      );
      if (namespaceFunction) {
        if (t.isFunctionExpression(namespaceFunction) || t.isArrowFunctionExpression(namespaceFunction)) {
          return extractFunctionReturnExpression(namespaceFunction);
        }

        if (t.isIdentifier(namespaceFunction)) {
          return resolveLocalFunctionReturn(fromFile, namespaceFunction.name, depth + 1, seen);
        }

        return namespaceFunction;
      }
    }

    const calleeExpression = t.isExpression(callee) ? callee : undefined;
    if (!calleeExpression) {
      return undefined;
    }

    const resolvedReference = resolveReferenceInternal(fromFile, calleeExpression, depth + 1, seen);
    if (!resolvedReference) {
      return undefined;
    }

    if (t.isFunctionExpression(resolvedReference) || t.isArrowFunctionExpression(resolvedReference)) {
      return extractFunctionReturnExpression(resolvedReference);
    }

    if (t.isIdentifier(resolvedReference)) {
      return resolveLocalFunctionReturn(fromFile, resolvedReference.name, depth + 1, seen);
    }

    return resolvedReference;
  };

  return {
    resolveReference(node: t.Expression): t.Expression | undefined {
      const fromFile = originForNode(node, entryFile);
      const resolved = resolveReferenceInternal(fromFile, node, 0, new Set());
      return markExpressionOrigin(resolved, fromFile);
    },
    resolveCallResult(callee: t.CallExpression['callee']): t.Expression | undefined {
      const fromFile = originForNode(callee, entryFile);
      const resolved = resolveCallResultInternal(fromFile, callee, 0, new Set());
      return markExpressionOrigin(resolved, fromFile);
    },
  };
}
