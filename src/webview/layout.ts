import { type Edge, type Node, Position } from '@xyflow/react';
import dagre from 'dagre';

import type { FlowNodeData } from './viewTypes';

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

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions,
): { nodes: Node[]; edges: Edge[] } {
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
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
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
