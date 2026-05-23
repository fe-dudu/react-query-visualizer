import { existsSync } from 'node:fs';
import * as path from 'node:path';

import type { GraphRoot } from './graphBuilder';
import type { AnalysisResult } from '../../shared/contracts';

export function toPosix(input: string): string {
  return input.split(path.sep).join('/');
}

function findBestRoot(roots: GraphRoot[], filePath: string): GraphRoot | undefined {
  const normalizedFile = path.resolve(filePath);

  let best: GraphRoot | undefined;
  let bestLength = -1;

  for (const root of roots) {
    const rootPath = path.resolve(root.path);
    const relative = path.relative(rootPath, normalizedFile);
    const inRoot = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    if (!inRoot) {
      continue;
    }

    if (rootPath.length > bestLength) {
      best = root;
      bestLength = rootPath.length;
    }
  }

  return best;
}

export function toDisplayPath(roots: GraphRoot[], filePath: string): string {
  const normalizedFile = path.resolve(filePath);
  const bestRoot = findBestRoot(roots, normalizedFile);

  if (!bestRoot) {
    return toPosix(normalizedFile);
  }

  const relative = toPosix(path.relative(bestRoot.path, normalizedFile));
  if (roots.length === 1) {
    return relative || '.';
  }

  const scoped = relative || '.';
  return `${bestRoot.name}/${scoped}`;
}

export function normalizeFilePath(filePath: string): string {
  return toPosix(path.resolve(filePath));
}

function inRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function hasPackageJson(directory: string, cache: Map<string, boolean>): boolean {
  const key = path.resolve(directory);
  const cached = cache.get(key);
  if (typeof cached === 'boolean') {
    return cached;
  }

  const value = existsSync(path.join(key, 'package.json'));
  cache.set(key, value);
  return value;
}

function nearestPackageBoundary(
  rootPath: string | undefined,
  filePath: string,
  packageJsonCache: Map<string, boolean>,
): string | undefined {
  let cursor = path.dirname(path.resolve(filePath));
  const normalizedRoot = rootPath ? path.resolve(rootPath) : undefined;

  while (true) {
    if ((!normalizedRoot || inRoot(normalizedRoot, cursor)) && hasPackageJson(cursor, packageJsonCache)) {
      return cursor;
    }

    if (normalizedRoot && cursor === normalizedRoot) {
      break;
    }

    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  return undefined;
}

export function projectScopeForFile(
  roots: GraphRoot[],
  filePath: string,
  scopeCache: Map<string, string>,
  packageJsonCache: Map<string, boolean>,
): string {
  const normalizedFile = path.resolve(filePath);
  const cacheKey = normalizedFile;
  const cached = scopeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const bestRoot = findBestRoot(roots, normalizedFile);

  if (!bestRoot) {
    const nearestBoundary = nearestPackageBoundary(undefined, normalizedFile, packageJsonCache);
    if (nearestBoundary) {
      const boundaryName = path.basename(nearestBoundary);
      const scope = `workspace:${boundaryName}`;
      scopeCache.set(cacheKey, scope);
      return scope;
    }

    const fallback = `workspace:${path.basename(path.dirname(normalizedFile)) || '*'}`;
    scopeCache.set(cacheKey, fallback);
    return fallback;
  }

  const normalizedRoot = path.resolve(bestRoot.path);
  const nearestBoundary = nearestPackageBoundary(normalizedRoot, normalizedFile, packageJsonCache);

  if (nearestBoundary && inRoot(normalizedRoot, nearestBoundary)) {
    const relativeBoundary = toPosix(path.relative(normalizedRoot, nearestBoundary)) || '.';
    const scope = `${bestRoot.name}:${relativeBoundary}`;
    scopeCache.set(cacheKey, scope);
    return scope;
  }

  const relative = toPosix(path.relative(bestRoot.path, normalizedFile));
  const segments = relative.split('/').filter(Boolean);
  if (segments.length >= 1) {
    const scope = `${bestRoot.name}:${segments[0]}`;
    scopeCache.set(cacheKey, scope);
    return scope;
  }

  const fallback = `${bestRoot.name}:*`;
  scopeCache.set(cacheKey, fallback);
  return fallback;
}

export function mapParseErrors(
  roots: GraphRoot[],
  parseErrors: AnalysisResult['parseErrors'],
): AnalysisResult['parseErrors'] {
  return parseErrors.map((error) => ({
    file: toDisplayPath(roots, error.file),
    message: error.message,
  }));
}
