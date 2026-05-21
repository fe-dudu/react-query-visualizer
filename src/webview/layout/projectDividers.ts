import type { Node } from '@xyflow/react';

import { getGraphLayoutIndex, projectLabelForLayoutNode } from './layoutIndex';
import { computeProjectBubbleFrame } from './projectLayout';
import {
  DEFAULT_NODE_HEIGHT,
  PROJECT_BAND_GAP,
  PROJECT_DIVIDER_BOTTOM_MARGIN,
  PROJECT_DIVIDER_LABEL_TOP_OFFSET,
  PROJECT_DIVIDER_TOP_MARGIN,
  PROJECT_TOP_DIVIDER_GAP,
} from './spacing';
import type { WebviewPayload } from '../types/model';
import { isDeclareActionNode } from '../utils/utils';

interface ProjectRange {
  label: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function buildProjectRanges(layoutedNodes: Node[], graph: WebviewPayload['graph']): Map<string, ProjectRange> {
  const { nodeById: graphNodeById, queryProjectById } = getGraphLayoutIndex(graph);
  const rangesByProject = new Map<string, ProjectRange>();

  for (const layoutedNode of layoutedNodes) {
    const graphNode = graphNodeById.get(layoutedNode.id);
    if (!graphNode) {
      continue;
    }

    if (graphNode.kind === 'action' && isDeclareActionNode(graphNode)) {
      continue;
    }

    if (graphNode.kind !== 'file' && graphNode.kind !== 'action' && graphNode.kind !== 'queryKey') {
      continue;
    }

    const projectLabel = projectLabelForLayoutNode(graphNode, queryProjectById);
    if (!projectLabel) {
      continue;
    }

    const nodeHeight = layoutedNode.measured?.height ?? layoutedNode.height ?? DEFAULT_NODE_HEIGHT;
    const nodeWidth = layoutedNode.measured?.width ?? layoutedNode.width ?? 340;
    const left = layoutedNode.position.x;
    const right = left + nodeWidth;
    const top = layoutedNode.position.y;
    const bottom = top + nodeHeight;
    const existing = rangesByProject.get(projectLabel);
    if (existing) {
      existing.minX = Math.min(existing.minX, left);
      existing.maxX = Math.max(existing.maxX, right);
      existing.minY = Math.min(existing.minY, top);
      existing.maxY = Math.max(existing.maxY, bottom);
      continue;
    }

    rangesByProject.set(projectLabel, {
      label: projectLabel,
      minX: left,
      maxX: right,
      minY: top,
      maxY: bottom,
    });
  }

  return rangesByProject;
}

function buildProjectShiftMap(
  layoutedNodes: Node[],
  graph: WebviewPayload['graph'],
  keepFirstDivider: boolean,
): Map<string, number> {
  if (!keepFirstDivider) {
    return new Map();
  }

  const rangesByProject = buildProjectRanges(layoutedNodes, graph);

  const sortedRanges = [...rangesByProject.values()].sort((a, b) => a.minY - b.minY || a.label.localeCompare(b.label));
  const shiftByProject = new Map<string, number>();
  let cursorTop = PROJECT_TOP_DIVIDER_GAP;

  for (const range of sortedRanges) {
    const offset = cursorTop - range.minY;
    shiftByProject.set(range.label, offset);

    const height = Math.max(0, range.maxY - range.minY);
    cursorTop += height + PROJECT_BAND_GAP;
  }

  return shiftByProject;
}

export function applyProjectBandSpacing(
  layoutedNodes: Node[],
  graph: WebviewPayload['graph'],
  keepFirstDivider: boolean,
): Node[] {
  if (!keepFirstDivider) {
    return layoutedNodes;
  }

  const shiftByProject = buildProjectShiftMap(layoutedNodes, graph, keepFirstDivider);
  if (shiftByProject.size === 0) {
    return layoutedNodes;
  }

  const { nodeById: graphNodeById, queryProjectById } = getGraphLayoutIndex(graph);

  return layoutedNodes.map((layoutedNode) => {
    const graphNode = graphNodeById.get(layoutedNode.id);
    if (!graphNode) {
      return layoutedNode;
    }

    const projectLabel = projectLabelForLayoutNode(graphNode, queryProjectById);
    if (!projectLabel) {
      return layoutedNode;
    }

    const shift = shiftByProject.get(projectLabel) ?? 0;
    if (shift === 0) {
      return layoutedNode;
    }

    return {
      ...layoutedNode,
      position: {
        x: layoutedNode.position.x,
        y: layoutedNode.position.y + shift,
      },
    };
  });
}

export function buildProjectDividerNodes(
  layoutedNodes: Node[],
  graph: WebviewPayload['graph'],
  keepFirstDivider: boolean,
  bubbleMode = false,
): Node[] {
  const projectRanges = buildProjectRanges(layoutedNodes, graph);
  if (projectRanges.size < 1) {
    return [];
  }

  if (!keepFirstDivider && projectRanges.size < 2) {
    return [];
  }

  if (bubbleMode) {
    const sortedRanges = [...projectRanges.values()].sort(
      (a, b) => a.minX - b.minX || a.minY - b.minY || a.label.localeCompare(b.label),
    );
    const dividers: Node[] = [];

    for (const [index, range] of sortedRanges.entries()) {
      if (!keepFirstDivider && index === 0) {
        continue;
      }
      const bubbleFrame = computeProjectBubbleFrame(range);

      dividers.push({
        id: `divider:${index}:${range.label}`,
        type: 'rqvDivider',
        data: {
          label: range.label,
          width: bubbleFrame.width,
          height: bubbleFrame.height,
          showLabel: true,
          variant: 'bubble',
        },
        position: {
          x: bubbleFrame.x,
          y: bubbleFrame.y,
        },
        selectable: false,
        draggable: false,
        connectable: false,
        deletable: false,
        focusable: false,
        style: {
          width: bubbleFrame.width,
          height: bubbleFrame.height,
          zIndex: 0,
          pointerEvents: 'none',
        },
      });
    }

    return dividers;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const layoutedNode of layoutedNodes) {
    const nodeWidth = layoutedNode.measured?.width ?? layoutedNode.width ?? 340;
    const nodeLeft = layoutedNode.position.x;
    const nodeRight = nodeLeft + nodeWidth;
    minX = Math.min(minX, nodeLeft);
    maxX = Math.max(maxX, nodeRight);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return [];
  }

  const horizontalPadding = 120;
  const dividerStartX = minX - horizontalPadding;
  const dividerWidth = Math.max(960, maxX - minX + horizontalPadding * 2);
  const sortedRanges = [...projectRanges.values()].sort((a, b) => a.minY - b.minY || a.label.localeCompare(b.label));
  const dividers: Node[] = [];

  for (const [index, range] of sortedRanges.entries()) {
    let boundaryY = range.minY - 28;
    let showLabel = true;

    if (index > 0) {
      const previous = sortedRanges[index - 1];
      if (!previous) {
        continue;
      }

      const interProjectGap = range.minY - previous.maxY;
      const requiredGap = PROJECT_DIVIDER_LABEL_TOP_OFFSET + PROJECT_DIVIDER_TOP_MARGIN + PROJECT_DIVIDER_BOTTOM_MARGIN;
      if (interProjectGap <= 8) {
        continue;
      }

      const centeredBoundaryY = previous.maxY + interProjectGap / 2;
      if (interProjectGap <= requiredGap) {
        boundaryY = centeredBoundaryY;
        showLabel = false;
      } else {
        const minBoundaryY = previous.maxY + PROJECT_DIVIDER_LABEL_TOP_OFFSET + PROJECT_DIVIDER_TOP_MARGIN;
        const maxBoundaryY = range.minY - PROJECT_DIVIDER_BOTTOM_MARGIN;
        boundaryY = Math.max(minBoundaryY, Math.min(centeredBoundaryY, maxBoundaryY));
      }
    } else if (!keepFirstDivider) {
      continue;
    }

    dividers.push({
      id: `divider:${index}:${range.label}`,
      type: 'rqvDivider',
      data: {
        label: range.label,
        width: dividerWidth,
        showLabel,
        variant: 'line',
      },
      position: {
        x: dividerStartX,
        y: boundaryY,
      },
      selectable: false,
      draggable: false,
      connectable: false,
      deletable: false,
      focusable: false,
      style: {
        width: dividerWidth,
        zIndex: 0,
        pointerEvents: 'none',
      },
    });
  }

  return dividers;
}
