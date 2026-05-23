import type { Edge, Node, Position } from '@xyflow/react';
import dagre from 'dagre';

import type { FlowNodeData } from '../types/viewTypes';

export interface LayoutOptions {
  direction: 'LR';
  verticalSpacing: number;
  horizontalSpacing: number;
}

const NODE_WIDTH = 340;
const NODE_MIN_HEIGHT = 173;
const PRIMARY_ROW_HEIGHT = 188;
const TITLE_CHARS_PER_LINE = 24;
const SUBTITLE_CHARS_PER_LINE = 32;
const SOURCE_POSITION = 'right' as Position;
const TARGET_POSITION = 'left' as Position;
const DENSE_GRAPH_EDGE_THRESHOLD = 3000;
const DENSE_GRAPH_EDGE_RATIO = 8;

function estimateWrappedLineCount(text: string, charsPerLine: number): number {
  if (!text) {
    return 1;
  }

  const lines = text
    .split('\n')
    .map((line) => Math.max(1, Math.ceil(line.trim().length / charsPerLine)))
    .reduce((sum, count) => sum + count, 0);

  return Math.max(1, lines);
}

function estimateNodeHeight(node: Node): number {
  const data = node.data as FlowNodeData | undefined;
  const title = typeof data?.title === 'string' ? data.title : '';
  const subtitle = typeof data?.subtitle === 'string' ? data.subtitle : '';
  const titleLines = estimateWrappedLineCount(title, TITLE_CHARS_PER_LINE);
  const subtitleLines = estimateWrappedLineCount(subtitle, SUBTITLE_CHARS_PER_LINE);

  // Matches the node card typography roughly, plus safety buffer to avoid visual overlaps.
  const estimated =
    22 + // container vertical padding
    30 + // header row + margin
    titleLines * 26 + // title 20px, 1.3 line height
    4 + // title margin-bottom
    subtitleLines * 22 + // subtitle 16px, 1.35 line height
    18; // conservative buffer for badges/line wrapping variance

  return Math.max(NODE_MIN_HEIGHT, estimated);
}

function nodeKind(node: Node): 'file' | 'action' | 'queryKey' | null {
  const data = node.data as FlowNodeData | undefined;
  const kindValue = data?.node?.kind;
  if (kindValue === 'file' || kindValue === 'action' || kindValue === 'queryKey') {
    return kindValue;
  }

  return null;
}

function nodeProjectScope(node: Node): string {
  const data = node.data as FlowNodeData | undefined;
  const projectScope = data?.node?.metrics?.projectScope;
  return typeof projectScope === 'string' && projectScope.length > 0 ? projectScope : 'workspace:*';
}

function getDenseGraphLayout(nodes: Node[], edges: Edge[], options: LayoutOptions): { nodes: Node[]; edges: Edge[] } {
  const columnGap = Math.max(200, Math.round(options.horizontalSpacing * 0.6));
  const projectGap = Math.max(240, Math.round(options.horizontalSpacing * 0.75));
  const rowGap = Math.max(24, options.verticalSpacing);
  const laneByKind: Record<'file' | 'action' | 'queryKey', number> = {
    file: 0,
    action: NODE_WIDTH + columnGap,
    queryKey: NODE_WIDTH * 2 + columnGap * 2,
  };

  let cursorY = 40;
  let previousProjectScope: string | null = null;

  const positionedNodes = nodes.map((node) => {
    const currentProjectScope = nodeProjectScope(node);
    if (previousProjectScope !== null && currentProjectScope !== previousProjectScope) {
      cursorY += projectGap;
    }
    previousProjectScope = currentProjectScope;

    const kind = nodeKind(node);
    const height = estimateNodeHeight(node);
    const width = NODE_WIDTH;
    const x = kind ? laneByKind[kind] : laneByKind.action;
    const positioned = {
      ...node,
      width,
      height,
      sourcePosition: SOURCE_POSITION,
      targetPosition: TARGET_POSITION,
      position: {
        x,
        y: cursorY,
      },
    };

    cursorY += height + rowGap;
    return positioned;
  });

  return {
    nodes: positionedNodes,
    edges,
  };
}

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions,
): { nodes: Node[]; edges: Edge[] } {
  const edgeThreshold = Math.max(DENSE_GRAPH_EDGE_THRESHOLD, nodes.length * DENSE_GRAPH_EDGE_RATIO);
  if (edges.length > edgeThreshold) {
    return getDenseGraphLayout(nodes, edges, options);
  }

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: options.direction,
    nodesep: options.verticalSpacing,
    ranksep: options.horizontalSpacing,
    marginx: 40,
    marginy: 40,
  });

  const nodeSizeById = new Map<string, { width: number; height: number }>();
  const estimatedHeightByNodeId = new Map<string, number>();
  let maxPrimaryRowHeight = PRIMARY_ROW_HEIGHT;

  nodes.forEach((node) => {
    const estimatedHeight = estimateNodeHeight(node);
    estimatedHeightByNodeId.set(node.id, estimatedHeight);
    const kind = nodeKind(node);
    if (kind) {
      maxPrimaryRowHeight = Math.max(maxPrimaryRowHeight, estimatedHeight);
    }
  });

  nodes.forEach((node) => {
    const estimatedHeight = estimatedHeightByNodeId.get(node.id) ?? NODE_MIN_HEIGHT;
    const kind = nodeKind(node);
    const height = kind ? maxPrimaryRowHeight : estimatedHeight;
    nodeSizeById.set(node.id, { width: NODE_WIDTH, height });
    graph.setNode(node.id, { width: NODE_WIDTH, height });
  });

  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  const positionedNodes = nodes.map((node) => {
    const size = nodeSizeById.get(node.id) ?? { width: NODE_WIDTH, height: NODE_MIN_HEIGHT };
    const positioned = graph.node(node.id);

    return {
      ...node,
      width: size.width,
      height: size.height,
      sourcePosition: SOURCE_POSITION,
      targetPosition: TARGET_POSITION,
      position: {
        x: positioned.x - size.width / 2,
        y: positioned.y - size.height / 2,
      },
    };
  });

  return {
    nodes: positionedNodes,
    edges,
  };
}
