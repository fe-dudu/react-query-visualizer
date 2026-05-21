import type { Node } from '@xyflow/react';

import { getGraphLayoutIndex } from './layoutIndex';
import { projectKeyForNode } from './layoutNodeMetrics';
import { parseProjectScope } from './projectScope';
import {
  DEFAULT_NODE_HEIGHT,
  MONOREPO_PROJECT_MAX_COLUMNS,
  MONOREPO_PROJECT_ROW_GAP,
  PROJECT_COLUMN_GAP,
} from './spacing';
import type { WebviewPayload } from '../model';
import { computeProjectGridShifts } from '../projectLayout';

export function isMonorepoGraph(graph: WebviewPayload['graph']): boolean {
  const packageScopedProjects = new Set<string>();

  for (const node of graph.nodes) {
    if (node.kind !== 'file' && node.kind !== 'action' && node.kind !== 'queryKey') {
      continue;
    }

    const parsed = parseProjectScope(node.metrics?.projectScope);
    if (!parsed) {
      continue;
    }

    // Monorepo-like package scopes typically include nested package paths such as apps/mobile or packages/core.
    if (!parsed.project.includes('/')) {
      continue;
    }

    packageScopedProjects.add(`${parsed.root}:${parsed.project}`);
    if (packageScopedProjects.size > 1) {
      return true;
    }
  }

  return false;
}

export function arrangeProjectsHorizontally(nodes: Node[], graph: WebviewPayload['graph'], enabled: boolean): Node[] {
  if (!enabled) {
    return nodes;
  }

  const { queryProjectById } = getGraphLayoutIndex(graph);
  const layoutNodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIdsByProject = new Map<string, string[]>();
  const boundsByProject = new Map<
    string,
    {
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
    }
  >();

  for (const graphNode of graph.nodes) {
    if (graphNode.kind !== 'file' && graphNode.kind !== 'action' && graphNode.kind !== 'queryKey') {
      continue;
    }

    const layoutNode = layoutNodeById.get(graphNode.id);
    if (!layoutNode) {
      continue;
    }

    const project = projectKeyForNode(graphNode, queryProjectById);
    const projectNodeIds = nodeIdsByProject.get(project) ?? [];
    projectNodeIds.push(graphNode.id);
    nodeIdsByProject.set(project, projectNodeIds);

    const nodeWidth = layoutNode.measured?.width ?? layoutNode.width ?? 340;
    const nodeHeight = layoutNode.measured?.height ?? layoutNode.height ?? DEFAULT_NODE_HEIGHT;
    const left = layoutNode.position.x;
    const right = left + nodeWidth;
    const top = layoutNode.position.y;
    const bottom = top + nodeHeight;

    const bounds = boundsByProject.get(project);
    if (!bounds) {
      boundsByProject.set(project, {
        minX: left,
        maxX: right,
        minY: top,
        maxY: bottom,
      });
      continue;
    }

    bounds.minX = Math.min(bounds.minX, left);
    bounds.maxX = Math.max(bounds.maxX, right);
    bounds.minY = Math.min(bounds.minY, top);
    bounds.maxY = Math.max(bounds.maxY, bottom);
  }

  if (boundsByProject.size <= 1) {
    return nodes;
  }

  const shiftByNodeId = new Map<string, { x: number; y: number }>();
  const projectShifts = computeProjectGridShifts(
    [...boundsByProject.entries()].map(([project, bounds]) => ({
      project,
      minX: bounds.minX,
      maxX: bounds.maxX,
      minY: bounds.minY,
      maxY: bounds.maxY,
    })),
    {
      columnGap: PROJECT_COLUMN_GAP,
      rowGap: MONOREPO_PROJECT_ROW_GAP,
      maxColumns: MONOREPO_PROJECT_MAX_COLUMNS,
    },
  );
  for (const [project, shift] of projectShifts.entries()) {
    const nodeIds = nodeIdsByProject.get(project);
    if (!nodeIds || nodeIds.length === 0) {
      continue;
    }
    for (const nodeId of nodeIds) {
      shiftByNodeId.set(nodeId, shift);
    }
  }

  if (shiftByNodeId.size === 0) {
    return nodes;
  }

  return nodes.map((node) => {
    const shift = shiftByNodeId.get(node.id);
    if (!shift) {
      return node;
    }

    return {
      ...node,
      position: {
        x: node.position.x + shift.x,
        y: node.position.y + shift.y,
      },
    };
  });
}
