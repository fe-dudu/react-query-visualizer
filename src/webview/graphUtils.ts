import type { BuiltInEdge, Edge, Node } from '@xyflow/react';

import type { GraphData, GraphEdge, GraphNode, GraphRelation, OperationRelation } from './model';
import type { FilterState, FlowEdgeData, FlowNodeData, NodeCallsite, NodeExplanation, NodeFileRef } from './viewTypes';
import { OPERATION_RELATIONS, RELATION_COLOR, SHARED_SOURCE_HANDLE_ID, SHARED_TARGET_HANDLE_ID } from './constants';
import { isDeclareActionNode, nodeFileDisplay, shortText } from './utils';

interface HighlightState {
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
  selectedNodeId: string | null;
}

const OPERATION_SORT_INDEX = new Map<OperationRelation, number>(
  OPERATION_RELATIONS.map((relation, index) => [relation, index]),
);
const EDGE_FLOW_DASH = '18 14';
const FLOW_BEZIER_CURVATURE = 0.42;

function isOperationRelation(value: unknown): value is OperationRelation {
  return (
    value === 'invalidates' ||
    value === 'refetches' ||
    value === 'cancels' ||
    value === 'resets' ||
    value === 'clears' ||
    value === 'removes' ||
    value === 'sets'
  );
}

function summarizeVisibleGraph(graph: GraphData): GraphData['summary'] {
  return {
    files: graph.nodes.filter((node) => node.kind === 'file').length,
    actions: graph.nodes.filter((node) => node.kind === 'action').length,
    queryKeys: graph.nodes.filter((node) => node.kind === 'queryKey').length,
    parseErrors: graph.parseErrors.length,
  };
}

function summarizeGroupedResolution(current: GraphNode, next: GraphNode): GraphNode['resolution'] {
  if (current.resolution === 'dynamic' || next.resolution === 'dynamic') {
    return 'dynamic';
  }

  return 'static';
}

function updateAllowedIdsForMatchedActions(
  scopedEdges: GraphEdge[],
  nodeById: Map<string, GraphNode>,
  matchedActionIds: Set<string>,
): Set<string> {
  const allowedIds = new Set<string>([...matchedActionIds]);

  for (const edge of scopedEdges) {
    const sourceKind = nodeById.get(edge.source)?.kind;
    const targetKind = nodeById.get(edge.target)?.kind;

    if (matchedActionIds.has(edge.source) && targetKind === 'queryKey') {
      allowedIds.add(edge.target);
    }

    if (matchedActionIds.has(edge.target) && sourceKind === 'file') {
      allowedIds.add(edge.source);
    }
  }

  return allowedIds;
}

function buildActionAndQueryMaps(graph: GraphData): {
  nodeById: Map<string, GraphNode>;
  actionToFileLabel: Map<string, string>;
  queryToActionIds: Map<string, Set<string>>;
  queryToFileLabels: Map<string, Set<string>>;
} {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const actionToFileLabel = new Map<string, string>();
  const queryToActionIds = new Map<string, Set<string>>();
  const queryToFileLabels = new Map<string, Set<string>>();

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);

    if (!source || !target) {
      continue;
    }

    if (source.kind === 'file' && target.kind === 'action') {
      actionToFileLabel.set(target.id, source.label);
      continue;
    }

    if (source.kind !== 'action' || target.kind !== 'queryKey') {
      continue;
    }

    if (!queryToActionIds.has(target.id)) {
      queryToActionIds.set(target.id, new Set());
    }
    queryToActionIds.get(target.id)?.add(source.id);

    const parentFile = actionToFileLabel.get(source.id) ?? nodeFileDisplay(source);
    if (!queryToFileLabels.has(target.id)) {
      queryToFileLabels.set(target.id, new Set());
    }
    queryToFileLabels.get(target.id)?.add(parentFile);
  }

  return {
    nodeById,
    actionToFileLabel,
    queryToActionIds,
    queryToFileLabels,
  };
}

function makeNodeSubtitle(
  node: GraphNode,
  actionToFileLabel: Map<string, string>,
  queryToActionIds: Map<string, Set<string>>,
  queryToFileLabels: Map<string, Set<string>>,
): { title: string; subtitle: string; relation?: GraphRelation } {
  if (node.kind === 'file') {
    const affected = Number(node.metrics?.affectedKeys ?? 0);
    return {
      title: node.label,
      subtitle: `File node · ${affected} linked query key${affected === 1 ? '' : 's'}`,
    };
  }

  if (node.kind === 'action') {
    const relation = (node.metrics?.relation as GraphRelation | undefined) ?? undefined;
    const fileLabel = actionToFileLabel.get(node.id) ?? nodeFileDisplay(node);
    const location = node.loc ? `${node.loc.line}:${node.loc.column}` : '-';

    return {
      title: node.label,
      subtitle: `Called in ${fileLabel} @ ${location}`,
      relation,
    };
  }

  const actionCount = queryToActionIds.get(node.id)?.size ?? 0;
  const fileCount = queryToFileLabels.get(node.id)?.size ?? 0;
  const declareFileCount = Number(node.metrics?.declaredFiles ?? 0);
  const declareCallsiteCount = Number(node.metrics?.declaredCallsites ?? 0);
  const declareText =
    declareFileCount > 0 || declareCallsiteCount > 0
      ? ` · defined in ${declareCallsiteCount} callsite${declareCallsiteCount === 1 ? '' : 's'} (${declareFileCount} file${declareFileCount === 1 ? '' : 's'})`
      : '';
  const grouped = Number(node.metrics?.grouped ?? 0);
  const groupedText = grouped > 0 ? ` | grouped ${grouped}` : '';

  return {
    title: node.label,
    subtitle: `QueryKey node · ${actionCount} callsite${actionCount === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'}${declareText}${groupedText}`,
  };
}

function actionRelation(actionNode: GraphNode): OperationRelation | null {
  const relation = actionNode.metrics?.relation;
  if (isOperationRelation(relation)) {
    return relation;
  }

  return null;
}

function actionOrder(actionNode: GraphNode): number {
  const relation = actionRelation(actionNode);
  if (!relation) {
    return OPERATION_RELATIONS.length + 1;
  }

  return OPERATION_SORT_INDEX.get(relation) ?? OPERATION_RELATIONS.length + 1;
}

function sortActionNodesByOperation(actionNodes: GraphNode[]): GraphNode[] {
  return [...actionNodes].sort((a, b) => {
    const operationDiff = actionOrder(a) - actionOrder(b);
    if (operationDiff !== 0) {
      return operationDiff;
    }

    const fileDiff = nodeFileDisplay(a).localeCompare(nodeFileDisplay(b));
    if (fileDiff !== 0) {
      return fileDiff;
    }

    const lineDiff = (a.loc?.line ?? Number.MAX_SAFE_INTEGER) - (b.loc?.line ?? Number.MAX_SAFE_INTEGER);
    if (lineDiff !== 0) {
      return lineDiff;
    }

    const columnDiff = (a.loc?.column ?? Number.MAX_SAFE_INTEGER) - (b.loc?.column ?? Number.MAX_SAFE_INTEGER);
    if (columnDiff !== 0) {
      return columnDiff;
    }

    return a.label.localeCompare(b.label);
  });
}

function actionLabel(actionNode: GraphNode): NodeCallsite {
  const file = nodeFileDisplay(actionNode);
  const relation = actionRelation(actionNode) ?? undefined;
  const line = actionNode.loc?.line;
  const column = actionNode.loc?.column;
  const loc = line && column ? `${line}:${column}` : '-';

  return {
    label: `${actionNode.label} in ${file} @ ${loc}`,
    file: actionNode.file,
    line,
    column,
    relation,
  };
}

function fileRef(label: string, file?: string, line?: number, column?: number): NodeFileRef {
  return {
    label,
    file,
    line,
    column,
  };
}

function sortFileRefs(files: NodeFileRef[]): NodeFileRef[] {
  return [...files].sort((a, b) => a.label.localeCompare(b.label));
}

function sortCallsites(callsites: NodeCallsite[]): NodeCallsite[] {
  return [...callsites].sort((a, b) => {
    const fileA = a.file ?? '';
    const fileB = b.file ?? '';
    if (fileA !== fileB) {
      return fileA.localeCompare(fileB);
    }

    const lineDiff = (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);
    if (lineDiff !== 0) {
      return lineDiff;
    }

    const columnDiff = (a.column ?? Number.MAX_SAFE_INTEGER) - (b.column ?? Number.MAX_SAFE_INTEGER);
    if (columnDiff !== 0) {
      return columnDiff;
    }

    return a.label.localeCompare(b.label);
  });
}

function nodeMatchesSearch(node: GraphNode, searchText: string): boolean {
  if (searchText.length === 0) {
    return true;
  }

  const target = `${node.label} ${nodeFileDisplay(node)}`.toLowerCase();
  return target.includes(searchText);
}

function relationHandleId(prefix: 'source' | 'target'): string {
  return prefix === 'source' ? SHARED_SOURCE_HANDLE_ID : SHARED_TARGET_HANDLE_ID;
}

function relationLaneBand(relation: GraphRelation): number {
  if (relation === 'declares') {
    return -120;
  }
  if (relation === 'sets') {
    return 120;
  }
  if (relation === 'removes') {
    return 96;
  }
  if (relation === 'resets') {
    return 72;
  }
  if (relation === 'clears') {
    return 24;
  }
  if (relation === 'cancels') {
    return -48;
  }
  if (relation === 'refetches') {
    return -24;
  }
  if (relation === 'invalidates') {
    return -72;
  }

  return 0;
}

function buildEdgeLaneOffsets(edges: GraphEdge[]): Map<string, number> {
  const groupedBySource = new Map<string, GraphEdge[]>();
  const groupedByTarget = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const sourceKey = `${edge.source}:${edge.relation}`;
    const sourceGroup = groupedBySource.get(sourceKey) ?? [];
    sourceGroup.push(edge);
    groupedBySource.set(sourceKey, sourceGroup);

    const targetKey = `${edge.target}:${edge.relation}`;
    const targetGroup = groupedByTarget.get(targetKey) ?? [];
    targetGroup.push(edge);
    groupedByTarget.set(targetKey, targetGroup);
  }

  const sourceLanes = new Map<string, number>();
  for (const group of groupedBySource.values()) {
    const sorted = [...group].sort((a, b) => {
      if (a.target !== b.target) {
        return a.target.localeCompare(b.target);
      }
      return a.id.localeCompare(b.id);
    });

    const centerIndex = (sorted.length - 1) / 2;
    for (const [index, edge] of sorted.entries()) {
      sourceLanes.set(edge.id, (index - centerIndex) * 40);
    }
  }

  const targetLanes = new Map<string, number>();
  for (const group of groupedByTarget.values()) {
    const sorted = [...group].sort((a, b) => {
      if (a.source !== b.source) {
        return a.source.localeCompare(b.source);
      }
      return a.id.localeCompare(b.id);
    });

    const centerIndex = (sorted.length - 1) / 2;
    for (const [index, edge] of sorted.entries()) {
      targetLanes.set(edge.id, (index - centerIndex) * 40);
    }
  }

  const laneOffsets = new Map<string, number>();
  for (const edge of edges) {
    const sourceLane = sourceLanes.get(edge.id) ?? 0;
    const targetLane = targetLanes.get(edge.id) ?? 0;
    laneOffsets.set(edge.id, sourceLane + targetLane + relationLaneBand(edge.relation));
  }

  return laneOffsets;
}

function buildExplanationForFile(
  graph: GraphData,
  selectedNode: GraphNode,
  nodeById: Map<string, GraphNode>,
): NodeExplanation {
  const outgoingEdges = graph.edges.filter((edge) => edge.source === selectedNode.id);

  const actionNodes = outgoingEdges
    .map((edge) => nodeById.get(edge.target))
    .filter((node): node is GraphNode => Boolean(node && node.kind === 'action'));
  const sortedActionNodes = sortActionNodesByOperation(actionNodes);

  const relationCounts = new Map<string, number>();
  for (const node of sortedActionNodes) {
    const relation = String(node.metrics?.relation ?? 'unknown');
    relationCounts.set(relation, (relationCounts.get(relation) ?? 0) + 1);
  }

  const queryKeys = new Set<string>();
  for (const actionNode of sortedActionNodes) {
    for (const edge of graph.edges.filter((item) => item.source === actionNode.id)) {
      const queryNode = nodeById.get(edge.target);
      if (queryNode?.kind === 'queryKey') {
        queryKeys.add(queryNode.label);
      }
    }
  }

  const relationText = [...relationCounts.entries()].map(([key, count]) => `${key}:${count}`).join(', ');

  return {
    summary: `${shortText(selectedNode.label, 80)} contains ${sortedActionNodes.length} callsites (${relationText || 'none'}) and links ${queryKeys.size} query keys.`,
    files: [
      fileRef(
        selectedNode.label,
        selectedNode.file ?? selectedNode.label,
        selectedNode.loc?.line,
        selectedNode.loc?.column,
      ),
    ],
    actions: sortedActionNodes.map((node) => actionLabel(node)),
    declarations: [],
    queryKeys: [...queryKeys].sort((a, b) => a.localeCompare(b)),
  };
}

function buildExplanationForAction(
  graph: GraphData,
  selectedNode: GraphNode,
  nodeById: Map<string, GraphNode>,
): NodeExplanation {
  const incomingEdges = graph.edges.filter((edge) => edge.target === selectedNode.id);
  const outgoingEdges = graph.edges.filter((edge) => edge.source === selectedNode.id);

  const fileNode = incomingEdges
    .map((edge) => nodeById.get(edge.source))
    .find((node): node is GraphNode => Boolean(node && node.kind === 'file'));

  const queryNodes = outgoingEdges
    .map((edge) => nodeById.get(edge.target))
    .filter((node): node is GraphNode => Boolean(node && node.kind === 'queryKey'));

  const relation = String(selectedNode.metrics?.relation ?? 'action');
  const loc = selectedNode.loc ? `${selectedNode.loc.line}:${selectedNode.loc.column}` : '-';
  const fileLabel = fileNode?.label ?? nodeFileDisplay(selectedNode);
  const filePath = fileNode?.label ?? selectedNode.file ?? fileLabel;

  return {
    summary: `${relation} call from ${shortText(fileLabel, 72)} @ ${loc}, affecting ${queryNodes.length} query keys.`,
    files: fileLabel ? [fileRef(fileLabel, filePath)] : [],
    actions: [actionLabel(selectedNode)],
    declarations: [],
    queryKeys: queryNodes.map((node) => node.label),
  };
}

function collectDeclarationCallsitesForQuery(
  graph: GraphData,
  queryNodeId: string,
  nodeById: Map<string, GraphNode>,
): NodeCallsite[] {
  const callsites: NodeCallsite[] = [];
  const dedupe = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.target !== queryNodeId) {
      continue;
    }

    const sourceNode = nodeById.get(edge.source);
    if (!(edge.relation === 'declares' && isDeclareActionNode(sourceNode))) {
      continue;
    }

    const callsite = actionLabel(sourceNode);
    const key = `${callsite.file ?? ''}:${callsite.line ?? 0}:${callsite.column ?? 0}:${callsite.label}`;
    if (dedupe.has(key)) {
      continue;
    }

    dedupe.add(key);
    callsites.push(callsite);
  }

  return sortCallsites(callsites);
}

function buildExplanationForQuery(
  graph: GraphData,
  declarationGraph: GraphData,
  selectedNode: GraphNode,
  nodeById: Map<string, GraphNode>,
): NodeExplanation {
  const incomingEdges = graph.edges.filter((edge) => edge.target === selectedNode.id);

  const actionNodes = incomingEdges
    .map((edge) => nodeById.get(edge.source))
    .filter((node): node is GraphNode => Boolean(node && node.kind === 'action'));
  const sortedActionNodes = sortActionNodesByOperation(actionNodes);

  const filesByKey = new Map<string, NodeFileRef>();
  for (const actionNode of sortedActionNodes) {
    const parentFile = graph.edges
      .filter((edge) => edge.target === actionNode.id)
      .map((edge) => nodeById.get(edge.source))
      .find((node): node is GraphNode => Boolean(node && node.kind === 'file'));

    if (parentFile) {
      filesByKey.set(parentFile.label, fileRef(parentFile.label, parentFile.label));
      continue;
    }

    const fallbackPath = actionNode.file ?? nodeFileDisplay(actionNode);
    if (fallbackPath) {
      filesByKey.set(fallbackPath, fileRef(fallbackPath, actionNode.file ?? fallbackPath));
    }
  }

  const declarationNodeById = new Map(declarationGraph.nodes.map((node) => [node.id, node]));
  const declarations = collectDeclarationCallsitesForQuery(declarationGraph, selectedNode.id, declarationNodeById);
  const declarationSummary =
    declarations.length > 0
      ? ` Defined in ${declarations.length} callsite${declarations.length === 1 ? '' : 's'}.`
      : '';

  return {
    summary: `${shortText(selectedNode.label, 80)} is referenced by ${sortedActionNodes.length} callsites in ${filesByKey.size} files.${declarationSummary}`,
    files: sortFileRefs([...filesByKey.values()]),
    actions: sortedActionNodes.map((node) => actionLabel(node)),
    declarations,
    queryKeys: [selectedNode.label],
  };
}

export function collapseGraphIfLarge(graph: GraphData, threshold = 800): { graph: GraphData; collapsed: boolean } {
  if (graph.nodes.length <= threshold) {
    return { graph, collapsed: false };
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const groupedQueryNodes = new Map<string, GraphNode>();
  const queryGroupIdByOriginalId = new Map<string, string>();
  const collapsedNodes: GraphNode[] = [];

  for (const node of graph.nodes) {
    if (node.kind !== 'queryKey') {
      collapsedNodes.push(node);
      continue;
    }

    const root = String(node.metrics?.rootSegment ?? 'other');
    const projectScope = typeof node.metrics?.projectScope === 'string' ? node.metrics.projectScope : 'workspace:*';
    const groupId = `qk-group:${projectScope}:${root}`;
    queryGroupIdByOriginalId.set(node.id, groupId);
    const current = groupedQueryNodes.get(groupId);
    const affectedFiles = Number(node.metrics?.affectedFiles ?? 0);

    if (!current) {
      groupedQueryNodes.set(groupId, {
        id: groupId,
        kind: 'queryKey',
        label: `Q:${root}/*`,
        resolution: node.resolution,
        metrics: {
          grouped: 1,
          affectedFiles,
          rootSegment: root,
          projectScope,
        },
      });
      continue;
    }

    groupedQueryNodes.set(groupId, {
      ...current,
      metrics: {
        ...current.metrics,
        grouped: Number(current.metrics?.grouped ?? 1) + 1,
        affectedFiles: Number(current.metrics?.affectedFiles ?? 0) + affectedFiles,
      },
      resolution: summarizeGroupedResolution(current, node),
    });
  }

  collapsedNodes.push(...groupedQueryNodes.values());

  const collapsedEdgesMap = new Map<string, GraphEdge>();
  for (const edge of graph.edges) {
    let target = edge.target;
    if (nodeById.get(edge.target)?.kind === 'queryKey') {
      target = queryGroupIdByOriginalId.get(edge.target) ?? edge.target;
    }

    const key = `${edge.source}->${target}:${edge.relation}`;
    if (!collapsedEdgesMap.has(key)) {
      collapsedEdgesMap.set(key, {
        ...edge,
        id: key,
        target,
      });
    }
  }

  return {
    collapsed: true,
    graph: {
      ...graph,
      nodes: collapsedNodes,
      edges: [...collapsedEdgesMap.values()],
      summary: {
        ...graph.summary,
        queryKeys: collapsedNodes.filter((node) => node.kind === 'queryKey').length,
      },
    },
  };
}

export function computeVisibleGraph(graph: GraphData, filters: FilterState): GraphData {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const allQueryKeyNodes = graph.nodes.filter((node) => node.kind === 'queryKey');
  const allQueryKeyIds = new Set(allQueryKeyNodes.map((node) => node.id));
  const enabledActionIds = new Set(
    graph.nodes
      .filter((node) => {
        if (node.kind !== 'action') {
          return false;
        }

        const relation = node.metrics?.relation;
        if (!isOperationRelation(relation)) {
          return false;
        }

        return filters.relation[relation];
      })
      .map((node) => node.id),
  );

  if (enabledActionIds.size === 0) {
    return {
      ...graph,
      nodes: allQueryKeyNodes,
      edges: [],
      summary: {
        files: 0,
        actions: 0,
        queryKeys: allQueryKeyNodes.length,
        parseErrors: graph.parseErrors.length,
      },
    };
  }

  const candidateEdges = graph.edges.filter((edge) => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode) {
      return false;
    }

    if (sourceNode.kind === 'file' && targetNode.kind === 'action') {
      return enabledActionIds.has(targetNode.id);
    }

    if (sourceNode.kind === 'action' && targetNode.kind === 'queryKey') {
      return enabledActionIds.has(sourceNode.id);
    }

    return false;
  });

  const candidateNodeIds = new Set<string>();
  for (const edge of candidateEdges) {
    candidateNodeIds.add(edge.source);
    candidateNodeIds.add(edge.target);
  }
  for (const queryKeyId of allQueryKeyIds) {
    candidateNodeIds.add(queryKeyId);
  }

  let scopedNodes = graph.nodes.filter((node) => candidateNodeIds.has(node.id));
  const scopedIds = new Set(scopedNodes.map((node) => node.id));
  let scopedEdges = candidateEdges.filter((edge) => scopedIds.has(edge.source) && scopedIds.has(edge.target));

  const fileQuery = filters.fileQuery.trim().toLowerCase();
  if (fileQuery.length === 0) {
    const visibleGraph = {
      ...graph,
      nodes: scopedNodes,
      edges: scopedEdges,
    };

    return {
      ...visibleGraph,
      summary: summarizeVisibleGraph(visibleGraph),
    };
  }

  const matchedActionIds = new Set(
    scopedNodes
      .filter((node) => node.kind === 'action' && nodeFileDisplay(node).toLowerCase().includes(fileQuery))
      .map((node) => node.id),
  );

  const matchedFileIds = new Set(
    scopedNodes
      .filter((node) => node.kind === 'file' && node.label.toLowerCase().includes(fileQuery))
      .map((node) => node.id),
  );

  for (const edge of scopedEdges) {
    if (matchedFileIds.has(edge.source) && nodeById.get(edge.target)?.kind === 'action') {
      matchedActionIds.add(edge.target);
    }
  }

  const allowedIds = updateAllowedIdsForMatchedActions(scopedEdges, nodeById, matchedActionIds);
  scopedEdges = scopedEdges.filter((edge) => allowedIds.has(edge.source) && allowedIds.has(edge.target));
  scopedNodes = scopedNodes.filter((node) => allowedIds.has(node.id));

  const visibleGraph = {
    ...graph,
    nodes: scopedNodes,
    edges: scopedEdges,
  };

  return {
    ...visibleGraph,
    summary: summarizeVisibleGraph(visibleGraph),
  };
}

export function applySearchFilter(graph: GraphData, search: string): GraphData {
  const searchText = search.trim().toLowerCase();
  if (searchText.length === 0) {
    return graph;
  }

  const matchedNodeIds = new Set(
    graph.nodes.filter((node) => nodeMatchesSearch(node, searchText)).map((node) => node.id),
  );
  if (matchedNodeIds.size === 0) {
    return {
      ...graph,
      nodes: [],
      edges: [],
      summary: {
        files: 0,
        actions: 0,
        queryKeys: 0,
        parseErrors: graph.parseErrors.length,
      },
    };
  }

  const edgesByNodeId = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    const sourceList = edgesByNodeId.get(edge.source) ?? [];
    sourceList.push(edge);
    edgesByNodeId.set(edge.source, sourceList);

    const targetList = edgesByNodeId.get(edge.target) ?? [];
    targetList.push(edge);
    edgesByNodeId.set(edge.target, targetList);
  }

  // Keep direct matches and nearby context (file-action-query chain) to avoid isolated nodes.
  const allowedNodeIds = new Set<string>(matchedNodeIds);
  let frontier = [...matchedNodeIds];

  for (let depth = 0; depth < 2; depth += 1) {
    if (frontier.length === 0) {
      break;
    }

    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      const linkedEdges = edgesByNodeId.get(nodeId) ?? [];
      for (const edge of linkedEdges) {
        const neighborId = edge.source === nodeId ? edge.target : edge.source;
        if (allowedNodeIds.has(neighborId)) {
          continue;
        }

        allowedNodeIds.add(neighborId);
        nextFrontier.push(neighborId);
      }
    }

    frontier = nextFrontier;
  }

  const scopedNodes = graph.nodes.filter((node) => allowedNodeIds.has(node.id));
  const scopedNodeIds = new Set(scopedNodes.map((node) => node.id));
  const scopedEdges = graph.edges.filter((edge) => scopedNodeIds.has(edge.source) && scopedNodeIds.has(edge.target));
  const visibleGraph = {
    ...graph,
    nodes: scopedNodes,
    edges: scopedEdges,
  };

  return {
    ...visibleGraph,
    summary: summarizeVisibleGraph(visibleGraph),
  };
}

export function buildFlowGraph(
  graph: GraphData,
  search: string,
  highlight?: HighlightState,
): { nodes: Node[]; edges: Edge[] } {
  const searchText = search.trim().toLowerCase();
  const { nodeById, actionToFileLabel, queryToActionIds, queryToFileLabels } = buildActionAndQueryMaps(graph);
  const selectedNodeId = highlight?.selectedNodeId ?? null;
  const hasSelection = Boolean(selectedNodeId && highlight);
  const edgeLaneOffsets = buildEdgeLaneOffsets(graph.edges);

  const nodes: Node[] = graph.nodes.map((node) => {
    const selected = node.id === selectedNodeId;
    const searchDim = !nodeMatchesSearch(node, searchText);
    const highlighted = highlight?.highlightedNodeIds.has(node.id) ?? false;
    const selectionDim = hasSelection && !highlighted;
    const dim = selected ? false : searchDim || selectionDim;
    let zIndex = 1;
    if (highlighted) {
      zIndex = 10;
    }
    if (selected) {
      zIndex = 20;
    }
    const { title, subtitle, relation } = makeNodeSubtitle(
      node,
      actionToFileLabel,
      queryToActionIds,
      queryToFileLabels,
    );
    const data: FlowNodeData = {
      node,
      title,
      subtitle,
      relation,
      dim,
      highlighted,
      selected,
    };

    return {
      id: node.id,
      type: 'rqvNode',
      data,
      position: { x: 0, y: 0 },
      style: {
        width: 340,
        opacity: dim ? 0.34 : 1,
        zIndex,
      },
    };
  });

  const edges: Edge[] = graph.edges.map((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const sourceMatch = source ? nodeMatchesSearch(source, searchText) : true;
    const targetMatch = target ? nodeMatchesSearch(target, searchText) : true;
    const searchDim = searchText.length > 0 && !sourceMatch && !targetMatch;
    const highlighted = highlight?.highlightedEdgeIds.has(edge.id) ?? false;
    const selectionDim = hasSelection && !highlighted;
    const dim = searchDim || selectionDim;
    const laneOffset = edgeLaneOffsets.get(edge.id) ?? 0;
    let edgeOpacity = 0.96;
    if (dim) {
      edgeOpacity = 0.14;
    } else if (highlighted) {
      edgeOpacity = 1;
    }
    const stroke = RELATION_COLOR[edge.relation];
    const strokeDasharray = highlighted ? EDGE_FLOW_DASH : undefined;

    const nextEdge: BuiltInEdge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: relationHandleId('source'),
      targetHandle: relationHandleId('target'),
      data: {
        relation: edge.relation,
        dim,
        highlighted,
        laneOffset,
      } satisfies FlowEdgeData,
      style: {
        stroke,
        strokeWidth: highlighted ? 3.2 : 2.4,
        opacity: edgeOpacity,
        strokeDasharray,
        strokeDashoffset: highlighted ? 0 : undefined,
        filter: highlighted ? `drop-shadow(0 0 7px ${stroke})` : 'none',
        strokeLinecap: 'round',
      },
      className: highlighted ? 'rqv-edge-flow' : undefined,
      animated: highlighted,
      type: 'default',
      pathOptions: {
        curvature: FLOW_BEZIER_CURVATURE,
      },
    };

    return nextEdge;
  });

  return { nodes, edges };
}

export function buildNodeExplanation(
  graph: GraphData,
  selectedNode: GraphNode | null,
  declarationGraph: GraphData = graph,
): NodeExplanation | null {
  if (!selectedNode) {
    return null;
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  if (selectedNode.kind === 'file') {
    return buildExplanationForFile(graph, selectedNode, nodeById);
  }

  if (selectedNode.kind === 'action') {
    return buildExplanationForAction(graph, selectedNode, nodeById);
  }

  return buildExplanationForQuery(graph, declarationGraph, selectedNode, nodeById);
}
