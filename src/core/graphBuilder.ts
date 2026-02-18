import { existsSync } from 'node:fs';
import * as path from 'node:path';

import type { AnalysisResult, GraphData, GraphNode, QueryRecord } from '../types';

export interface GraphRoot {
  name: string;
  path: string;
}

function toPosix(input: string): string {
  return input.split(path.sep).join('/');
}

function makeFileNodeId(filePath: string): string {
  return `file:${filePath}`;
}

function makeActionNodeId(record: QueryRecord, index: number): string {
  return `action:${record.file}:${record.loc.line}:${record.loc.column}:${record.operation}:${index}`;
}

function makeQueryKeyNodeId(queryKeyId: string): string {
  return `qk:${queryKeyId}`;
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

function toDisplayPath(roots: GraphRoot[], filePath: string): string {
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

function normalizeFilePath(filePath: string): string {
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

function projectScopeForFile(
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

function isWildcardQueryKey(record: QueryRecord): boolean {
  if (record.queryKey.source === 'wildcard') {
    return true;
  }

  if (record.queryKey.id === '*' || record.queryKey.id === 'all-query-cache') {
    return true;
  }

  return false;
}

function isDeclarationAnchorRecord(record: Pick<QueryRecord, 'relation' | 'operation' | 'queryKey'>): boolean {
  return record.relation === 'declares';
}

function normalizeComparableSegments(key: QueryRecord['queryKey']): string[] {
  return key.segments.filter((segment) => segment.length > 0 && segment !== 'UNRESOLVED');
}

function isDynamicSegment(segment: string): boolean {
  const normalized = segment.trim();
  if (!normalized) {
    return true;
  }

  if (normalized === 'UNRESOLVED') {
    return true;
  }

  if (normalized.startsWith('$')) {
    return true;
  }

  if (normalized.includes('${')) {
    return true;
  }

  if (normalized.includes('UNRESOLVED')) {
    return true;
  }

  if (normalized.startsWith('call(') || normalized.startsWith('cond(')) {
    return true;
  }

  return false;
}

function segmentsCompatible(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }

  if (isDynamicSegment(left) || isDynamicSegment(right)) {
    return true;
  }

  return false;
}

function hasPrefixSegments(prefix: string[], value: string[]): boolean {
  if (prefix.length > value.length) {
    return false;
  }

  for (let index = 0; index < prefix.length; index += 1) {
    if (!segmentsCompatible(prefix[index], value[index])) {
      return false;
    }
  }

  return true;
}

function actionAffectsDeclaredQueryKey(
  actionQueryKey: QueryRecord['queryKey'],
  declaredQueryKey: QueryRecord['queryKey'],
): boolean {
  // `invalidateQueries({ queryKey })` pass-through cannot be safely expanded.
  // Keep it as its own dynamic key node instead of matching every declared key.
  if (actionQueryKey.id === 'pass-through-query-key') {
    return false;
  }

  if (
    actionQueryKey.source === 'wildcard' ||
    actionQueryKey.matchMode === 'all' ||
    actionQueryKey.matchMode === 'predicate'
  ) {
    return true;
  }

  if (actionQueryKey.id === declaredQueryKey.id) {
    return true;
  }

  const actionSegments = normalizeComparableSegments(actionQueryKey);
  const declaredSegments = normalizeComparableSegments(declaredQueryKey);
  if (actionSegments.length === 0 || declaredSegments.length === 0) {
    return false;
  }

  if (actionQueryKey.matchMode === 'exact') {
    return actionSegments.length === declaredSegments.length && hasPrefixSegments(actionSegments, declaredSegments);
  }

  return hasPrefixSegments(actionSegments, declaredSegments);
}

function isSetAnchoredConcreteKey(queryKey: QueryRecord['queryKey']): boolean {
  if (queryKey.source === 'wildcard') {
    return false;
  }

  if (
    queryKey.id === 'pass-through-query-key' ||
    queryKey.id === 'all-query-cache' ||
    queryKey.id === 'unresolved_query_key'
  ) {
    return false;
  }

  return true;
}

function mapParseErrors(roots: GraphRoot[], parseErrors: AnalysisResult['parseErrors']): AnalysisResult['parseErrors'] {
  return parseErrors.map((error) => ({
    file: toDisplayPath(roots, error.file),
    message: error.message,
  }));
}

export function buildGraph(roots: GraphRoot[], analysis: AnalysisResult): GraphData {
  const effectiveRoots = roots.length > 0 ? roots : [{ name: 'workspace', path: process.cwd() }];

  const nodeMap = new Map<string, GraphNode>();
  const edgeMap = new Map<string, GraphData['edges'][number]>();

  const fileToKeys = new Map<string, Set<string>>();
  const fileToProjectScope = new Map<string, string>();
  const queryKeyToFiles = new Map<string, Set<string>>();
  const queryKeyToDeclareFiles = new Map<string, Set<string>>();
  const queryKeyToDeclareCallsites = new Map<string, number>();
  const queryKeyToProjects = new Map<string, Set<string>>();
  const declaredQueryNodeIds = new Set<string>();
  const declaredQueryKeyByNodeId = new Map<string, QueryRecord['queryKey']>();
  const declaredQueryProjectsByNodeId = new Map<string, Set<string>>();
  const queryKeyToProjectCounts = new Map<string, Map<string, number>>();
  const projectScopeCache = new Map<string, string>();
  const packageJsonCache = new Map<string, boolean>();
  const setAnchoredQueryNodeIds = new Set<string>();
  const pendingActionToQueryLinks: Array<{
    actionNodeId: string;
    operation: string;
    relation: QueryRecord['relation'];
    resolution: QueryRecord['resolution'];
    file: string;
    projectScope: string;
    queryKey: QueryRecord['queryKey'];
    wildcard: boolean;
    queryKeyNodeId?: string;
  }> = [];

  analysis.records.forEach((record, index) => {
    const absoluteFile = normalizeFilePath(record.file);
    const displayFile = toDisplayPath(effectiveRoots, absoluteFile);
    const projectScope = projectScopeForFile(effectiveRoots, absoluteFile, projectScopeCache, packageJsonCache);
    fileToProjectScope.set(absoluteFile, projectScope);

    const fileNodeId = makeFileNodeId(absoluteFile);
    const actionNodeId = makeActionNodeId(record, index);
    const queryKeyNodeId = makeQueryKeyNodeId(record.queryKey.id);
    const wildcardQuery = isWildcardQueryKey(record);

    if (!nodeMap.has(fileNodeId)) {
      nodeMap.set(fileNodeId, {
        id: fileNodeId,
        kind: 'file',
        label: displayFile,
        file: absoluteFile,
        resolution: 'static',
      });
    }

    if (!nodeMap.has(actionNodeId)) {
      nodeMap.set(actionNodeId, {
        id: actionNodeId,
        kind: 'action',
        label: record.operation,
        file: absoluteFile,
        loc: record.loc,
        resolution: record.resolution,
        metrics: {
          relation: record.relation,
          displayFile,
          projectScope,
          declaresDirectly: record.declaresDirectly === true ? 1 : 0,
        },
      });
    }

    if (!wildcardQuery && !nodeMap.has(queryKeyNodeId)) {
      nodeMap.set(queryKeyNodeId, {
        id: queryKeyNodeId,
        kind: 'queryKey',
        label: record.queryKey.display,
        resolution: record.queryKey.resolution,
        metrics: {
          matchMode: record.queryKey.matchMode,
          rootSegment: record.queryKey.segments[0] ?? 'unknown',
        },
      });
    }

    if (!wildcardQuery) {
      if (!queryKeyToProjects.has(queryKeyNodeId)) {
        queryKeyToProjects.set(queryKeyNodeId, new Set());
      }
      queryKeyToProjects.get(queryKeyNodeId)?.add(projectScope);

      if (!queryKeyToProjectCounts.has(queryKeyNodeId)) {
        queryKeyToProjectCounts.set(queryKeyNodeId, new Map());
      }
      const projectCounts = queryKeyToProjectCounts.get(queryKeyNodeId);
      if (projectCounts) {
        projectCounts.set(projectScope, (projectCounts.get(projectScope) ?? 0) + 1);
      }

      if (isDeclarationAnchorRecord(record)) {
        declaredQueryNodeIds.add(queryKeyNodeId);
        if (!declaredQueryKeyByNodeId.has(queryKeyNodeId)) {
          declaredQueryKeyByNodeId.set(queryKeyNodeId, record.queryKey);
        }

        const projects = declaredQueryProjectsByNodeId.get(queryKeyNodeId) ?? new Set<string>();
        projects.add(projectScope);
        declaredQueryProjectsByNodeId.set(queryKeyNodeId, projects);
      }
    }

    const edgeA = `${fileNodeId}->${actionNodeId}:${record.relation}`;

    if (!edgeMap.has(edgeA)) {
      edgeMap.set(edgeA, {
        id: edgeA,
        source: fileNodeId,
        target: actionNodeId,
        relation: record.relation,
        resolution: record.resolution,
      });
    }

    pendingActionToQueryLinks.push({
      actionNodeId,
      operation: record.operation,
      relation: record.relation,
      resolution: record.resolution,
      file: absoluteFile,
      projectScope,
      queryKey: record.queryKey,
      wildcard: wildcardQuery,
      queryKeyNodeId: wildcardQuery ? undefined : queryKeyNodeId,
    });
  });

  const declaredQueryNodeIdList = [...declaredQueryNodeIds];

  for (const pending of pendingActionToQueryLinks) {
    let targets: string[] = [];
    if (pending.relation === 'declares') {
      if (pending.queryKeyNodeId) {
        targets = [pending.queryKeyNodeId];
      }
    } else if (pending.wildcard) {
      targets = declaredQueryNodeIdList.filter((queryKeyNodeId) => {
        const projects = declaredQueryProjectsByNodeId.get(queryKeyNodeId);
        return projects?.has(pending.projectScope) ?? false;
      });
    } else if (pending.queryKeyNodeId) {
      const matchedTargets = declaredQueryNodeIdList.filter((queryKeyNodeId) => {
        const declaredQueryKey = declaredQueryKeyByNodeId.get(queryKeyNodeId);
        if (!declaredQueryKey) {
          return false;
        }

        const projects = declaredQueryProjectsByNodeId.get(queryKeyNodeId);
        if (!(projects?.has(pending.projectScope) ?? false)) {
          return false;
        }

        return actionAffectsDeclaredQueryKey(pending.queryKey, declaredQueryKey);
      });
      targets = matchedTargets.length > 0 ? matchedTargets : [pending.queryKeyNodeId];
    }
    for (const target of targets) {
      if (pending.relation === 'sets' && target.startsWith('qk:') && isSetAnchoredConcreteKey(pending.queryKey)) {
        setAnchoredQueryNodeIds.add(target);
      }

      const edgeB = `${pending.actionNodeId}->${target}:${pending.relation}`;
      if (!edgeMap.has(edgeB)) {
        edgeMap.set(edgeB, {
          id: edgeB,
          source: pending.actionNodeId,
          target,
          relation: pending.relation,
          resolution: pending.resolution,
        });
      }

      if (!fileToKeys.has(pending.file)) {
        fileToKeys.set(pending.file, new Set());
      }
      fileToKeys.get(pending.file)?.add(target);

      if (!queryKeyToFiles.has(target)) {
        queryKeyToFiles.set(target, new Set());
      }
      queryKeyToFiles.get(target)?.add(pending.file);

      if (isDeclarationAnchorRecord(pending)) {
        if (!queryKeyToDeclareFiles.has(target)) {
          queryKeyToDeclareFiles.set(target, new Set());
        }
        queryKeyToDeclareFiles.get(target)?.add(pending.file);
        queryKeyToDeclareCallsites.set(target, (queryKeyToDeclareCallsites.get(target) ?? 0) + 1);
      }
    }
  }

  for (const node of nodeMap.values()) {
    if (node.kind === 'file') {
      const key = node.file ?? node.label;
      const count = fileToKeys.get(key)?.size ?? 0;
      const projectScope = fileToProjectScope.get(key) ?? 'workspace:*';
      node.metrics = {
        ...(node.metrics ?? {}),
        affectedKeys: count,
        projectScope,
      };
    }

    if (node.kind === 'queryKey') {
      const count = queryKeyToFiles.get(node.id)?.size ?? 0;
      const declareFiles = queryKeyToDeclareFiles.get(node.id)?.size ?? 0;
      const declareCallsites = queryKeyToDeclareCallsites.get(node.id) ?? 0;
      const projectCounts = queryKeyToProjectCounts.get(node.id);
      let projectScope: string | undefined;
      if (projectCounts && projectCounts.size > 0) {
        const [primaryProject] = [...projectCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        projectScope = primaryProject?.[0];
      } else {
        const projects = queryKeyToProjects.get(node.id);
        if (projects && projects.size > 0) {
          projectScope = [...projects].sort((a, b) => a.localeCompare(b))[0];
        }
      }

      node.metrics = {
        ...(node.metrics ?? {}),
        affectedFiles: count,
        declaredFiles: declareFiles,
        declaredCallsites: declareCallsites,
        projectScope: projectScope ?? 'workspace:*',
      };
    }
  }

  const allNodes = [...nodeMap.values()];
  const definedQueryKeyNodeIds = new Set(
    allNodes
      .filter((node) => node.kind === 'queryKey')
      .filter((node) => {
        if (Number(node.metrics?.declaredCallsites ?? 0) > 0) {
          return true;
        }
        return setAnchoredQueryNodeIds.has(node.id);
      })
      .map((node) => node.id),
  );

  const nodes = allNodes.filter((node) => node.kind !== 'queryKey' || definedQueryKeyNodeIds.has(node.id));
  const allowedNodeIds = new Set(nodes.map((node) => node.id));
  const edges = [...edgeMap.values()].filter(
    (edge) => allowedNodeIds.has(edge.source) && allowedNodeIds.has(edge.target),
  );

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const actionToFileNodeIds = new Map<string, Set<string>>();
  const actionToQueryNodeIds = new Map<string, Set<string>>();
  for (const edge of edges) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode) {
      continue;
    }

    if (sourceNode.kind === 'file' && targetNode.kind === 'action') {
      const fileNodeIds = actionToFileNodeIds.get(targetNode.id) ?? new Set<string>();
      fileNodeIds.add(sourceNode.id);
      actionToFileNodeIds.set(targetNode.id, fileNodeIds);
      continue;
    }

    if (sourceNode.kind === 'action' && targetNode.kind === 'queryKey') {
      const queryNodeIds = actionToQueryNodeIds.get(sourceNode.id) ?? new Set<string>();
      queryNodeIds.add(targetNode.id);
      actionToQueryNodeIds.set(sourceNode.id, queryNodeIds);
    }
  }

  const fileNodeIdToQueryIds = new Map<string, Set<string>>();
  const queryNodeIdToFileIds = new Map<string, Set<string>>();
  for (const [actionNodeId, queryNodeIds] of actionToQueryNodeIds.entries()) {
    const fileNodeIds = actionToFileNodeIds.get(actionNodeId);
    if (!fileNodeIds || fileNodeIds.size === 0) {
      continue;
    }

    for (const fileNodeId of fileNodeIds) {
      const linkedQueryIds = fileNodeIdToQueryIds.get(fileNodeId) ?? new Set<string>();
      for (const queryNodeId of queryNodeIds) {
        linkedQueryIds.add(queryNodeId);
        const linkedFileIds = queryNodeIdToFileIds.get(queryNodeId) ?? new Set<string>();
        linkedFileIds.add(fileNodeId);
        queryNodeIdToFileIds.set(queryNodeId, linkedFileIds);
      }
      fileNodeIdToQueryIds.set(fileNodeId, linkedQueryIds);
    }
  }

  for (const node of nodes) {
    if (node.kind === 'file') {
      node.metrics = {
        ...(node.metrics ?? {}),
        affectedKeys: fileNodeIdToQueryIds.get(node.id)?.size ?? 0,
      };
      continue;
    }

    if (node.kind === 'queryKey') {
      node.metrics = {
        ...(node.metrics ?? {}),
        affectedFiles: queryNodeIdToFileIds.get(node.id)?.size ?? 0,
      };
    }
  }

  const mappedErrors = mapParseErrors(effectiveRoots, analysis.parseErrors);

  return {
    nodes,
    edges,
    summary: {
      files: nodes.filter((node) => node.kind === 'file').length,
      actions: nodes.filter((node) => node.kind === 'action').length,
      queryKeys: nodes.filter((node) => node.kind === 'queryKey').length,
      parseErrors: mappedErrors.length,
    },
    parseErrors: mappedErrors,
  };
}
