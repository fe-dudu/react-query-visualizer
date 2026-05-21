import type { BuiltInEdge, Edge, Node } from '@xyflow/react';

import { RELATION_COLOR, SHARED_SOURCE_HANDLE_ID, SHARED_TARGET_HANDLE_ID } from './constants';
import { type HighlightState, nodeMatchesSearch } from './shared';
import { nodeFileDisplay } from './utils';
import type { GraphData, GraphEdge, GraphNode, GraphRelation } from '../types/model';
import type { FlowEdgeData, FlowNodeData } from '../types/viewTypes';

const EDGE_FLOW_DASH = '18 14';
const FLOW_BEZIER_CURVATURE = 0.42;

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
