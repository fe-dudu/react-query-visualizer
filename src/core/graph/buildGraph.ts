import type { GraphRoot, PendingActionToQueryLink } from './graphBuilderTypes';
import { makeActionNodeId, makeFileNodeId, makeQueryKeyNodeId } from './nodeIds';
import { mapParseErrors, normalizeFilePath, projectScopeForFile, toDisplayPath } from './paths';
import {
  actionAffectsDeclaredQueryKey,
  isDeclarationAnchorRecord,
  isSetAnchoredConcreteKey,
  isWildcardQueryKey,
} from './queryKeyMatching';
import type { AnalysisResult, GraphData, GraphNode, QueryRecord } from '../../shared/types';

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
  const declaredQueryClientScopesByNodeId = new Map<string, Set<string>>();
  const declaredQueryExecutionScopesByNodeId = new Map<string, Set<string>>();
  const declaredQuerySuiteScopesByNodeId = new Map<string, Set<string>>();
  const queryKeyToProjectCounts = new Map<string, Map<string, number>>();
  const projectScopeCache = new Map<string, string>();
  const packageJsonCache = new Map<string, boolean>();
  const setAnchoredQueryNodeIds = new Set<string>();
  const pendingActionToQueryLinks: PendingActionToQueryLink[] = [];

  analysis.records.forEach((record, index) => {
    const absoluteFile = normalizeFilePath(record.file);
    const displayFile = toDisplayPath(effectiveRoots, absoluteFile);
    const projectScope = projectScopeForFile(effectiveRoots, absoluteFile, projectScopeCache, packageJsonCache);
    fileToProjectScope.set(absoluteFile, projectScope);

    const fileNodeId = makeFileNodeId(absoluteFile);
    const actionNodeId = makeActionNodeId(record, index);
    const wildcardQuery = isWildcardQueryKey(record);
    const queryKeyNodeId = wildcardQuery ? undefined : makeQueryKeyNodeId(projectScope, record.queryKey.id);

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

    if (queryKeyNodeId && !nodeMap.has(queryKeyNodeId)) {
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

    if (queryKeyNodeId) {
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

        if (record.clientScopeId) {
          const clientScopes = declaredQueryClientScopesByNodeId.get(queryKeyNodeId) ?? new Set<string>();
          clientScopes.add(record.clientScopeId);
          declaredQueryClientScopesByNodeId.set(queryKeyNodeId, clientScopes);
        }

        if (record.executionScopeId) {
          const executionScopes = declaredQueryExecutionScopesByNodeId.get(queryKeyNodeId) ?? new Set<string>();
          executionScopes.add(record.executionScopeId);
          declaredQueryExecutionScopesByNodeId.set(queryKeyNodeId, executionScopes);
        }

        if (record.suiteScopeId) {
          const suiteScopes = declaredQuerySuiteScopesByNodeId.get(queryKeyNodeId) ?? new Set<string>();
          suiteScopes.add(record.suiteScopeId);
          declaredQuerySuiteScopesByNodeId.set(queryKeyNodeId, suiteScopes);
        }
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
      clientScopeId: record.clientScopeId,
      executionScopeId: record.executionScopeId,
      suiteScopeId: record.suiteScopeId,
      queryKey: record.queryKey,
      wildcard: wildcardQuery,
      queryKeyNodeId,
    });
  });

  const declaredQueryNodeIdList = [...declaredQueryNodeIds];

  function filterTargetsByScope(
    targets: string[],
    clientScopeId: string | undefined,
    executionScopeId: string | undefined,
    suiteScopeId: string | undefined,
    strictWhenScoped = false,
  ): string[] {
    if (executionScopeId) {
      const executionScopedTargets = targets.filter((queryKeyNodeId) =>
        declaredQueryExecutionScopesByNodeId.get(queryKeyNodeId)?.has(executionScopeId),
      );
      if (executionScopedTargets.length > 0) {
        return executionScopedTargets;
      }
      if (strictWhenScoped) {
        return [];
      }
    }

    if (suiteScopeId) {
      const suiteScopedTargets = targets.filter((queryKeyNodeId) =>
        declaredQuerySuiteScopesByNodeId.get(queryKeyNodeId)?.has(suiteScopeId),
      );
      if (suiteScopedTargets.length > 0) {
        return suiteScopedTargets;
      }
      if (strictWhenScoped) {
        return [];
      }
    }

    if (!clientScopeId) {
      return targets;
    }

    const scopedTargets = targets.filter((queryKeyNodeId) =>
      declaredQueryClientScopesByNodeId.get(queryKeyNodeId)?.has(clientScopeId),
    );
    if (scopedTargets.length > 0) {
      return scopedTargets;
    }

    return strictWhenScoped ? [] : targets;
  }

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
      targets = filterTargetsByScope(
        targets,
        pending.clientScopeId,
        pending.executionScopeId,
        pending.suiteScopeId,
        pending.operation === 'clear' && Boolean(pending.executionScopeId || pending.suiteScopeId),
      );
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
      targets = filterTargetsByScope(
        matchedTargets.length > 0 ? matchedTargets : [pending.queryKeyNodeId],
        pending.clientScopeId,
        pending.executionScopeId,
        pending.suiteScopeId,
      );
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
