import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';

import type { GraphNode, ScannedFile, WebviewPayload } from './model';
import type { FilterState, FlowEdgeData, NodeCallsite, NodeFileRef } from './viewTypes';
import { RqvFlowNode } from './components/FlowNode';
import { LeftPanel } from './components/LeftPanel';
import { ProjectDividerNode } from './components/ProjectDividerNode';
import { RightPanel } from './components/RightPanel';
import { ResizeDivider } from './components/resizeDivider';
import {
  applySearchFilter,
  buildFlowGraph,
  buildNodeExplanation,
  collapseGraphIfLarge,
  computeVisibleGraph,
} from './graphUtils';
import { useResizablePanels } from './hooks/useResizablePanels';
import { getLayoutedElements } from './layout';
import { cx, isDeclareActionNode } from './utils';
import { vscode } from './vscode';

const defaultFilters: FilterState = {
  relation: {
    invalidates: true,
    refetches: false,
    cancels: false,
    resets: false,
    removes: false,
    sets: false,
    clears: false,
  },
  fileQuery: '',
  search: '',
};

function revealNodeInCode(node: GraphNode): void {
  if (!node.file) {
    return;
  }

  vscode?.postMessage({
    type: 'reveal',
    file: node.file,
    line: node.loc?.line ?? 1,
    column: node.loc?.column ?? 1,
  });
}

function revealCallsiteInCode(callsite: NodeCallsite): void {
  if (!callsite.file) {
    return;
  }

  vscode?.postMessage({
    type: 'reveal',
    file: callsite.file,
    line: callsite.line ?? 1,
    column: callsite.column ?? 1,
  });
}

function revealFileInCode(fileRef: NodeFileRef): void {
  if (!fileRef.file) {
    return;
  }

  vscode?.postMessage({
    type: 'reveal',
    file: fileRef.file,
    line: fileRef.line ?? 1,
    column: fileRef.column ?? 1,
  });
}

function depthFromPath(filePath: string): number {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return 0;
  }

  return parts.length - 1;
}

function normalizePathSegments(input: string): string[] {
  return input.split('/').filter(Boolean);
}

function stripWorkspacePrefix(filePath: string, workspace: string): string {
  if (!workspace) {
    return filePath;
  }

  const prefix = `${workspace}/`;
  if (!filePath.startsWith(prefix)) {
    return filePath;
  }

  return filePath.slice(prefix.length);
}

function parseProjectScope(metricScope: unknown): { root: string; project: string } | null {
  if (typeof metricScope !== 'string') {
    return null;
  }

  const colonIndex = metricScope.indexOf(':');
  if (colonIndex < 0) {
    const normalized = metricScope.trim();
    if (!normalized) {
      return null;
    }

    return { root: '', project: normalized };
  }

  const root = metricScope.slice(0, colonIndex).trim();
  const suffix = metricScope.slice(colonIndex + 1).trim();
  if (!suffix || suffix === '.' || suffix === '*') {
    return { root, project: root || 'workspace' };
  }

  return { root, project: suffix };
}

function projectLabelFromScope(metricScope: unknown): string | null {
  const parsed = parseProjectScope(metricScope);
  if (!parsed) {
    return null;
  }

  if (parsed.root && parsed.project && parsed.project !== parsed.root) {
    return `${parsed.root}/${parsed.project}`;
  }

  return parsed.project || parsed.root || null;
}

function inferProjectFromPath(filePath: string, workspace: string): string {
  const scopedPath = stripWorkspacePrefix(filePath, workspace);
  const segments = normalizePathSegments(scopedPath);
  if (segments.length >= 2) {
    return `${segments[0]}/${segments[1]}`;
  }
  if (segments.length === 1) {
    return segments[0];
  }

  return workspace || 'workspace';
}

function makeProjectRelativePath(filePath: string, workspace: string, project: string): string {
  const scopedPath = stripWorkspacePrefix(filePath, workspace);
  const pathSegments = normalizePathSegments(scopedPath);
  const projectSegments = normalizePathSegments(project);

  if (pathSegments.length === 0) {
    return filePath;
  }

  const matchesPrefix =
    projectSegments.length > 0 &&
    projectSegments.every((segment, index) => pathSegments[index] && pathSegments[index] === segment);

  if (!matchesPrefix) {
    return scopedPath;
  }

  const remainder = pathSegments.slice(projectSegments.length).join('/');
  return remainder || pathSegments[pathSegments.length - 1] || scopedPath;
}

function buildRelatedFiles(allScannedFiles: ScannedFile[], visibleGraph: WebviewPayload['graph']): ScannedFile[] {
  const fileByPath = new Map(allScannedFiles.map((file) => [file.path, file]));
  const workspaceCount = new Set(allScannedFiles.map((file) => file.workspace).filter(Boolean)).size;
  const multiWorkspace = workspaceCount > 1;
  const fileNodes = visibleGraph.nodes.filter((node) => node.kind === 'file');

  return fileNodes
    .map((fileNode) => {
      const matched = fileByPath.get(fileNode.label);
      const workspace = matched?.workspace ?? '';
      const parsedScope = parseProjectScope(fileNode.metrics?.projectScope);
      const baseProject = parsedScope?.project ?? inferProjectFromPath(fileNode.label, workspace);
      const scopedProject = multiWorkspace && workspace ? `${workspace}/${baseProject}` : baseProject;
      const impact = Number(fileNode.metrics?.affectedKeys ?? 0);

      return {
        path: fileNode.label,
        workspace,
        depth: matched?.depth ?? depthFromPath(fileNode.label),
        impact,
        project: scopedProject,
        projectRelativePath: makeProjectRelativePath(fileNode.label, workspace, baseProject),
      } satisfies ScannedFile;
    })
    .sort(
      (a, b) =>
        (a.project ?? '').localeCompare(b.project ?? '') ||
        Number(b.impact ?? 0) - Number(a.impact ?? 0) ||
        a.path.localeCompare(b.path),
    );
}

interface ProjectRange {
  label: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const DEFAULT_NODE_HEIGHT = 173;
const PROJECT_TOP_DIVIDER_GAP = 42;
const PROJECT_BAND_GAP = 8;
const FILE_ACTION_PROJECT_GAP = 48;
const PROJECT_COLUMN_GAP = 168;
const DECLARE_ACTION_QUERY_GAP = 56;
const PROJECT_DIVIDER_TOP_MARGIN = 23;
const PROJECT_DIVIDER_BOTTOM_MARGIN = 11;
const PROJECT_DIVIDER_LABEL_TOP_OFFSET = 20;
const VERTICAL_SPACING_MIN = 0;
const VERTICAL_SPACING_MAX = 300;
const HORIZONTAL_SPACING_MIN = 100;
const HORIZONTAL_SPACING_MAX = 3000;
const LANE_COLUMN_BUCKET_SIZE = 96;
const LANE_VALUE_BUCKET_SIZE = 14;
const LANE_COLLISION_SPREAD = 18;

function resolveVerticalRowGap(verticalSpacing: number): number {
  return Math.max(0, Math.round(verticalSpacing));
}

function clampVerticalSpacing(value: number): number {
  return Math.max(VERTICAL_SPACING_MIN, Math.min(VERTICAL_SPACING_MAX, Math.round(value)));
}

function clampHorizontalSpacing(value: number): number {
  return Math.max(HORIZONTAL_SPACING_MIN, Math.min(HORIZONTAL_SPACING_MAX, Math.round(value)));
}

function buildQueryProjectMap(graph: WebviewPayload['graph']): Map<string, string> {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const countsByQuery = new Map<string, Map<string, number>>();

  for (const edge of graph.edges) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode || sourceNode.kind !== 'action' || targetNode.kind !== 'queryKey') {
      continue;
    }

    const projectLabel = projectLabelFromScope(sourceNode.metrics?.projectScope);
    if (!projectLabel) {
      continue;
    }

    const bucket = countsByQuery.get(targetNode.id) ?? new Map<string, number>();
    bucket.set(projectLabel, (bucket.get(projectLabel) ?? 0) + 1);
    countsByQuery.set(targetNode.id, bucket);
  }

  const projectByQuery = new Map<string, string>();
  for (const [queryNodeId, bucket] of countsByQuery.entries()) {
    const sorted = [...bucket.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const best = sorted[0];
    if (best) {
      projectByQuery.set(queryNodeId, best[0]);
    }
  }

  return projectByQuery;
}

function projectLabelForLayoutNode(graphNode: GraphNode, queryProjectById: Map<string, string>): string | null {
  if (graphNode.kind === 'queryKey') {
    return queryProjectById.get(graphNode.id) ?? projectLabelFromScope(graphNode.metrics?.projectScope) ?? null;
  }

  return projectLabelFromScope(graphNode.metrics?.projectScope);
}

function buildProjectRanges(layoutedNodes: Node[], graph: WebviewPayload['graph']): Map<string, ProjectRange> {
  const graphNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const queryProjectById = buildQueryProjectMap(graph);
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

function applyProjectBandSpacing(
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

  const graphNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const queryProjectById = buildQueryProjectMap(graph);

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

function buildProjectDividerNodes(
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

      const horizontalPadding = 72;
      const topPadding = 82;
      const bottomPadding = 52;
      const bubbleX = range.minX - horizontalPadding;
      const bubbleY = range.minY - topPadding;
      const bubbleWidth = Math.max(860, range.maxX - range.minX + horizontalPadding * 2);
      const bubbleHeight = Math.max(260, range.maxY - range.minY + topPadding + bottomPadding);

      dividers.push({
        id: `divider:${index}:${range.label}`,
        type: 'rqvDivider',
        data: {
          label: range.label,
          width: bubbleWidth,
          height: bubbleHeight,
          showLabel: true,
          variant: 'bubble',
        },
        position: {
          x: bubbleX,
          y: bubbleY,
        },
        selectable: false,
        draggable: false,
        connectable: false,
        deletable: false,
        focusable: false,
        style: {
          width: bubbleWidth,
          height: bubbleHeight,
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

function countProjects(graph: WebviewPayload['graph']): number {
  const queryProjectById = buildQueryProjectMap(graph);
  const projects = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind === 'action' && isDeclareActionNode(node)) {
      continue;
    }

    if (node.kind !== 'file' && node.kind !== 'action' && node.kind !== 'queryKey') {
      continue;
    }

    const label = projectLabelForLayoutNode(node, queryProjectById);
    if (!label) {
      continue;
    }

    projects.add(label);
  }

  return projects.size;
}

function isMonorepoGraph(graph: WebviewPayload['graph']): boolean {
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

function projectKeyForNode(graphNode: GraphNode | undefined, queryProjectById: Map<string, string>): string {
  if (!graphNode) {
    return 'workspace';
  }

  if (graphNode.kind === 'queryKey') {
    return queryProjectById.get(graphNode.id) ?? projectLabelFromScope(graphNode.metrics?.projectScope) ?? 'workspace';
  }

  return projectLabelFromScope(graphNode.metrics?.projectScope) ?? 'workspace';
}

function orderWeightForNode(graphNode: GraphNode | undefined): number {
  if (!graphNode) {
    return 2;
  }

  if (graphNode.kind === 'file') {
    return 0;
  }

  if (graphNode.kind === 'action') {
    if (isDeclareActionNode(graphNode)) {
      return 3;
    }
    return 1;
  }

  return 2;
}

function fileImpactForNode(graphNode: GraphNode | undefined): number {
  if (!graphNode || graphNode.kind !== 'file') {
    return 0;
  }

  return Number(graphNode.metrics?.affectedKeys ?? 0);
}

function queryImpactForNode(graphNode: GraphNode | undefined, queryCallsiteImpactById: Map<string, number>): number {
  if (!graphNode || graphNode.kind !== 'queryKey') {
    return 0;
  }

  return queryCallsiteImpactById.get(graphNode.id) ?? Number(graphNode.metrics?.affectedFiles ?? 0);
}

function buildQueryCallsiteImpactMap(graph: WebviewPayload['graph']): Map<string, number> {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const queryCallsiteImpactById = new Map<string, number>();

  for (const edge of graph.edges) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (!sourceNode || !targetNode || sourceNode.kind !== 'action' || targetNode.kind !== 'queryKey') {
      continue;
    }

    queryCallsiteImpactById.set(targetNode.id, (queryCallsiteImpactById.get(targetNode.id) ?? 0) + 1);
  }

  return queryCallsiteImpactById;
}

function orderNodesForLayout(
  nodes: Node[],
  graph: WebviewPayload['graph'],
  queryCallsiteImpactById: Map<string, number>,
): Node[] {
  const graphNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const queryProjectById = buildQueryProjectMap(graph);
  const actionImpactById = new Map<string, number>();

  for (const edge of graph.edges) {
    const sourceNode = graphNodeById.get(edge.source);
    const targetNode = graphNodeById.get(edge.target);
    if (!sourceNode || !targetNode || sourceNode.kind !== 'file' || targetNode.kind !== 'action') {
      continue;
    }

    actionImpactById.set(targetNode.id, fileImpactForNode(sourceNode));
  }

  return [...nodes].sort((a, b) => {
    const graphNodeA = graphNodeById.get(a.id);
    const graphNodeB = graphNodeById.get(b.id);

    const projectA = projectKeyForNode(graphNodeA, queryProjectById);
    const projectB = projectKeyForNode(graphNodeB, queryProjectById);
    if (projectA !== projectB) {
      return projectA.localeCompare(projectB);
    }

    const kindA = orderWeightForNode(graphNodeA);
    const kindB = orderWeightForNode(graphNodeB);
    if (kindA !== kindB) {
      return kindA - kindB;
    }

    if (graphNodeA?.kind === 'file' && graphNodeB?.kind === 'file') {
      const impactDiff = fileImpactForNode(graphNodeB) - fileImpactForNode(graphNodeA);
      if (impactDiff !== 0) {
        return impactDiff;
      }
    }

    if (
      graphNodeA?.kind === 'action' &&
      graphNodeB?.kind === 'action' &&
      !isDeclareActionNode(graphNodeA) &&
      !isDeclareActionNode(graphNodeB)
    ) {
      const impactA = actionImpactById.get(graphNodeA.id) ?? 0;
      const impactB = actionImpactById.get(graphNodeB.id) ?? 0;
      if (impactA !== impactB) {
        return impactB - impactA;
      }
    }

    if (graphNodeA?.kind === 'queryKey' && graphNodeB?.kind === 'queryKey') {
      const impactDiff =
        queryImpactForNode(graphNodeB, queryCallsiteImpactById) -
        queryImpactForNode(graphNodeA, queryCallsiteImpactById);
      if (impactDiff !== 0) {
        return impactDiff;
      }
    }

    const labelA = graphNodeA?.label ?? a.id;
    const labelB = graphNodeB?.label ?? b.id;
    return labelA.localeCompare(labelB);
  });
}

function alignQueryNodesNearSources(
  nodes: Node[],
  graph: WebviewPayload['graph'],
  queryCallsiteImpactById: Map<string, number>,
  verticalSpacing: number,
): Node[] {
  const graphNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const layoutNodeById = new Map(nodes.map((node) => [node.id, node]));
  const queryProjectById = buildQueryProjectMap(graph);
  const queryIdsByProject = new Map<string, string[]>();
  const projectNodeIdsByProject = new Map<string, string[]>();
  const actionIdsByQuery = new Map<string, string[]>();

  for (const edge of graph.edges) {
    const sourceNode = graphNodeById.get(edge.source);
    const targetNode = graphNodeById.get(edge.target);
    if (!sourceNode || !targetNode) {
      continue;
    }

    if (sourceNode.kind !== 'action' || isDeclareActionNode(sourceNode) || targetNode.kind !== 'queryKey') {
      continue;
    }

    if (!layoutNodeById.has(sourceNode.id) || !layoutNodeById.has(targetNode.id)) {
      continue;
    }

    const list = actionIdsByQuery.get(targetNode.id) ?? [];
    list.push(sourceNode.id);
    actionIdsByQuery.set(targetNode.id, list);
  }

  for (const graphNode of graph.nodes) {
    if (!layoutNodeById.has(graphNode.id)) {
      continue;
    }

    if (graphNode.kind === 'action' && isDeclareActionNode(graphNode)) {
      continue;
    }

    if (graphNode.kind !== 'file' && graphNode.kind !== 'action' && graphNode.kind !== 'queryKey') {
      continue;
    }

    const project = projectKeyForNode(graphNode, queryProjectById);
    const projectNodeIds = projectNodeIdsByProject.get(project) ?? [];
    projectNodeIds.push(graphNode.id);
    projectNodeIdsByProject.set(project, projectNodeIds);

    if (graphNode.kind !== 'queryKey') {
      continue;
    }

    const queryIds = queryIdsByProject.get(project) ?? [];
    queryIds.push(graphNode.id);
    queryIdsByProject.set(project, queryIds);
  }

  if (queryIdsByProject.size === 0) {
    return nodes;
  }

  const rowNodeIds = nodes
    .map((node) => graphNodeById.get(node.id))
    .filter((graphNode): graphNode is GraphNode => Boolean(graphNode))
    .filter((graphNode) => graphNode.kind === 'file' || graphNode.kind === 'action' || graphNode.kind === 'queryKey')
    .filter((graphNode) => !(graphNode.kind === 'action' && isDeclareActionNode(graphNode)))
    .map((graphNode) => graphNode.id);
  const maxRowNodeHeight = rowNodeIds.reduce((maxHeight, nodeId) => {
    const node = layoutNodeById.get(nodeId);
    if (!node) {
      return maxHeight;
    }

    const nodeHeight = node.measured?.height ?? node.height ?? DEFAULT_NODE_HEIGHT;
    return Math.max(maxHeight, nodeHeight);
  }, DEFAULT_NODE_HEIGHT);
  const rowStep = maxRowNodeHeight + resolveVerticalRowGap(verticalSpacing);
  const yByNodeId = new Map<string, number>();

  for (const [project, projectQueryIds] of queryIdsByProject.entries()) {
    const projectNodeIds = projectNodeIdsByProject.get(project) ?? [];
    if (projectNodeIds.length === 0 || projectQueryIds.length === 0) {
      continue;
    }

    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const nodeId of projectNodeIds) {
      const y = layoutNodeById.get(nodeId)?.position.y;
      if (typeof y !== 'number') {
        continue;
      }
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
      continue;
    }

    const queryIds = [...new Set(projectQueryIds)].sort((queryIdA, queryIdB) => {
      const actionCountDiff =
        (actionIdsByQuery.get(queryIdB)?.length ?? 0) - (actionIdsByQuery.get(queryIdA)?.length ?? 0);
      if (actionCountDiff !== 0) {
        return actionCountDiff;
      }

      const impactDiff = (queryCallsiteImpactById.get(queryIdB) ?? 0) - (queryCallsiteImpactById.get(queryIdA) ?? 0);
      if (impactDiff !== 0) {
        return impactDiff;
      }

      const yA = layoutNodeById.get(queryIdA)?.position.y ?? 0;
      const yB = layoutNodeById.get(queryIdB)?.position.y ?? 0;
      if (yA !== yB) {
        return yA - yB;
      }

      const labelA = graphNodeById.get(queryIdA)?.label ?? queryIdA;
      const labelB = graphNodeById.get(queryIdB)?.label ?? queryIdB;
      return labelA.localeCompare(labelB);
    });

    const projectRowSpan = Math.max(1, Math.round((maxY - minY) / rowStep) + 1);
    const rowCount = Math.max(projectRowSpan, queryIds.length);
    const availableRows = new Set<number>(Array.from({ length: rowCount }, (_, index) => index));
    const clampRow = (value: number): number => Math.max(0, Math.min(rowCount - 1, value));
    const rowFromY = (value: number): number => clampRow(Math.round((value - minY) / rowStep));

    for (const queryId of queryIds) {
      const sourceActionIds = actionIdsByQuery.get(queryId) ?? [];
      const sourceActionYs = [...new Set(sourceActionIds)]
        .map((actionId) => layoutNodeById.get(actionId)?.position.y)
        .filter((value): value is number => typeof value === 'number')
        .sort((a, b) => a - b);
      const currentQueryY = layoutNodeById.get(queryId)?.position.y ?? minY;
      const preferredY =
        sourceActionYs.length > 0
          ? (sourceActionYs[Math.floor(sourceActionYs.length / 2)] ?? currentQueryY)
          : currentQueryY;
      const preferredRow = rowFromY(preferredY);

      let selectedRow = preferredRow;
      let selectedDistance = Number.POSITIVE_INFINITY;
      for (const rowIndex of availableRows) {
        const distance = Math.abs(rowIndex - preferredRow);
        if (distance < selectedDistance || (distance === selectedDistance && rowIndex < selectedRow)) {
          selectedRow = rowIndex;
          selectedDistance = distance;
        }
      }

      if (availableRows.has(selectedRow)) {
        availableRows.delete(selectedRow);
      }

      yByNodeId.set(queryId, minY + selectedRow * rowStep);
    }
  }

  if (yByNodeId.size === 0) {
    return nodes;
  }

  return nodes.map((node) => {
    const nextY = yByNodeId.get(node.id);
    if (typeof nextY !== 'number') {
      return node;
    }

    return {
      ...node,
      position: {
        x: node.position.x,
        y: nextY,
      },
    };
  });
}

function alignQueryNodesToRightColumn(nodes: Node[], graph: WebviewPayload['graph'], groupByProject = false): Node[] {
  const graphNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const queryProjectById = buildQueryProjectMap(graph);

  if (groupByProject) {
    const boundsByProject = new Map<
      string,
      {
        rightMostNonQueryRight: number;
        rightMostQueryX: number;
      }
    >();

    for (const node of nodes) {
      const graphNode = graphNodeById.get(node.id);
      if (!graphNode) {
        continue;
      }

      const project = projectKeyForNode(graphNode, queryProjectById);
      const bucket = boundsByProject.get(project) ?? {
        rightMostNonQueryRight: Number.NEGATIVE_INFINITY,
        rightMostQueryX: Number.NEGATIVE_INFINITY,
      };

      const nodeWidth = node.measured?.width ?? node.width ?? 340;
      const nodeRight = node.position.x + nodeWidth;

      if (graphNode.kind === 'queryKey') {
        bucket.rightMostQueryX = Math.max(bucket.rightMostQueryX, node.position.x);
      } else {
        bucket.rightMostNonQueryRight = Math.max(bucket.rightMostNonQueryRight, nodeRight);
      }

      boundsByProject.set(project, bucket);
    }

    const targetXByProject = new Map<string, number>();
    for (const [project, bounds] of boundsByProject.entries()) {
      if (!Number.isFinite(bounds.rightMostQueryX)) {
        continue;
      }

      const targetX = Number.isFinite(bounds.rightMostNonQueryRight)
        ? Math.max(bounds.rightMostQueryX, bounds.rightMostNonQueryRight + DECLARE_ACTION_QUERY_GAP)
        : bounds.rightMostQueryX;
      targetXByProject.set(project, targetX);
    }

    if (targetXByProject.size === 0) {
      return nodes;
    }

    return nodes.map((node) => {
      const graphNode = graphNodeById.get(node.id);
      if (!graphNode || graphNode.kind !== 'queryKey') {
        return node;
      }

      const project = projectKeyForNode(graphNode, queryProjectById);
      const nextX = targetXByProject.get(project);
      if (typeof nextX !== 'number') {
        return node;
      }

      return {
        ...node,
        position: {
          x: nextX,
          y: node.position.y,
        },
      };
    });
  }

  let rightMostNonQueryRight = Number.NEGATIVE_INFINITY;
  let rightMostQueryX = Number.NEGATIVE_INFINITY;
  let hasQueryNode = false;

  for (const node of nodes) {
    const graphNode = graphNodeById.get(node.id);
    if (!graphNode) {
      continue;
    }

    const nodeWidth = node.measured?.width ?? node.width ?? 340;
    const nodeRight = node.position.x + nodeWidth;

    if (graphNode.kind === 'queryKey') {
      hasQueryNode = true;
      rightMostQueryX = Math.max(rightMostQueryX, node.position.x);
      continue;
    }

    rightMostNonQueryRight = Math.max(rightMostNonQueryRight, nodeRight);
  }

  if (!hasQueryNode) {
    return nodes;
  }

  const targetQueryX = Number.isFinite(rightMostNonQueryRight)
    ? Math.max(rightMostQueryX, rightMostNonQueryRight + DECLARE_ACTION_QUERY_GAP)
    : rightMostQueryX;

  return nodes.map((node) => {
    const graphNode = graphNodeById.get(node.id);
    if (!graphNode || graphNode.kind !== 'queryKey') {
      return node;
    }

    return {
      ...node,
      position: {
        x: targetQueryX,
        y: node.position.y,
      },
    };
  });
}

function alignDeclareNodesLeftOfQuery(nodes: Node[], graph: WebviewPayload['graph']): Node[] {
  const graphNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const layoutNodeById = new Map(nodes.map((node) => [node.id, node]));
  const nextXById = new Map<string, number>();

  for (const edge of graph.edges) {
    if (edge.relation !== 'declares') {
      continue;
    }

    const sourceGraphNode = graphNodeById.get(edge.source);
    const targetGraphNode = graphNodeById.get(edge.target);
    if (
      !sourceGraphNode ||
      !targetGraphNode ||
      !isDeclareActionNode(sourceGraphNode) ||
      targetGraphNode.kind !== 'queryKey'
    ) {
      continue;
    }

    const actionNode = layoutNodeById.get(sourceGraphNode.id);
    const queryNode = layoutNodeById.get(targetGraphNode.id);
    if (!actionNode || !queryNode) {
      continue;
    }

    const actionWidth = actionNode.measured?.width ?? actionNode.width ?? 340;
    const desiredX = queryNode.position.x - actionWidth - DECLARE_ACTION_QUERY_GAP;
    const currentX = nextXById.get(sourceGraphNode.id) ?? actionNode.position.x;
    nextXById.set(sourceGraphNode.id, Math.min(currentX, desiredX));
  }

  if (nextXById.size === 0) {
    return nodes;
  }

  return nodes.map((node) => {
    const nextX = nextXById.get(node.id);
    if (typeof nextX !== 'number') {
      return node;
    }

    return {
      ...node,
      position: {
        x: nextX,
        y: node.position.y,
      },
    };
  });
}

function arrangeProjectsHorizontally(nodes: Node[], graph: WebviewPayload['graph'], enabled: boolean): Node[] {
  if (!enabled) {
    return nodes;
  }

  const queryProjectById = buildQueryProjectMap(graph);
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

  const sortedProjects = [...boundsByProject.entries()]
    .sort((a, b) => a[1].minX - b[1].minX || a[1].minY - b[1].minY || a[0].localeCompare(b[0]))
    .map(([project]) => project);

  const topBaseline = sortedProjects.reduce((minY, project) => {
    const bounds = boundsByProject.get(project);
    if (!bounds) {
      return minY;
    }
    return Math.min(minY, bounds.minY);
  }, Number.POSITIVE_INFINITY);

  if (!Number.isFinite(topBaseline)) {
    return nodes;
  }

  let cursorX = sortedProjects.reduce((minX, project) => {
    const bounds = boundsByProject.get(project);
    if (!bounds) {
      return minX;
    }
    return Math.min(minX, bounds.minX);
  }, Number.POSITIVE_INFINITY);

  if (!Number.isFinite(cursorX)) {
    return nodes;
  }

  const shiftByNodeId = new Map<string, { x: number; y: number }>();
  for (const project of sortedProjects) {
    const bounds = boundsByProject.get(project);
    const nodeIds = nodeIdsByProject.get(project);
    if (!bounds || !nodeIds || nodeIds.length === 0) {
      continue;
    }

    const shiftX = cursorX - bounds.minX;
    const shiftY = topBaseline - bounds.minY;
    for (const nodeId of nodeIds) {
      shiftByNodeId.set(nodeId, { x: shiftX, y: shiftY });
    }

    const width = Math.max(0, bounds.maxX - bounds.minX);
    cursorX += width + PROJECT_COLUMN_GAP;
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

function compareActionOrder(
  actionA: GraphNode | undefined,
  actionB: GraphNode | undefined,
  fallbackA: Node | undefined,
  fallbackB: Node | undefined,
): number {
  const lineA = actionA?.loc?.line ?? Number.POSITIVE_INFINITY;
  const lineB = actionB?.loc?.line ?? Number.POSITIVE_INFINITY;
  if (lineA !== lineB) {
    return lineA - lineB;
  }

  const columnA = actionA?.loc?.column ?? Number.POSITIVE_INFINITY;
  const columnB = actionB?.loc?.column ?? Number.POSITIVE_INFINITY;
  if (columnA !== columnB) {
    return columnA - columnB;
  }

  const yA = fallbackA?.position.y ?? 0;
  const yB = fallbackB?.position.y ?? 0;
  if (yA !== yB) {
    return yA - yB;
  }

  const labelA = actionA?.label ?? fallbackA?.id ?? '';
  const labelB = actionB?.label ?? fallbackB?.id ?? '';
  return labelA.localeCompare(labelB);
}

function alignFileActionGroups(nodes: Node[], graph: WebviewPayload['graph'], verticalSpacing: number): Node[] {
  const graphNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const layoutNodeById = new Map(nodes.map((node) => [node.id, node]));
  const queryProjectById = buildQueryProjectMap(graph);
  const bucketsByProject = new Map<
    string,
    {
      fileIds: string[];
      actionIds: string[];
      queryIds: string[];
    }
  >();
  const actionIdsByFile = new Map<string, string[]>();

  for (const edge of graph.edges) {
    const sourceNode = graphNodeById.get(edge.source);
    const targetNode = graphNodeById.get(edge.target);
    if (!sourceNode || !targetNode || sourceNode.kind !== 'file' || targetNode.kind !== 'action') {
      continue;
    }

    if (isDeclareActionNode(targetNode)) {
      continue;
    }

    if (!layoutNodeById.has(sourceNode.id) || !layoutNodeById.has(targetNode.id)) {
      continue;
    }

    const linkedActions = actionIdsByFile.get(sourceNode.id) ?? [];
    linkedActions.push(targetNode.id);
    actionIdsByFile.set(sourceNode.id, linkedActions);
  }

  for (const graphNode of graph.nodes) {
    if (!layoutNodeById.has(graphNode.id)) {
      continue;
    }

    if (graphNode.kind === 'action' && isDeclareActionNode(graphNode)) {
      continue;
    }

    const project = projectKeyForNode(graphNode, queryProjectById);
    const bucket = bucketsByProject.get(project) ?? {
      fileIds: [],
      actionIds: [],
      queryIds: [],
    };

    if (graphNode.kind === 'file') {
      bucket.fileIds.push(graphNode.id);
    } else if (graphNode.kind === 'action') {
      bucket.actionIds.push(graphNode.id);
    } else if (graphNode.kind === 'queryKey') {
      bucket.queryIds.push(graphNode.id);
    } else {
      continue;
    }

    bucketsByProject.set(project, bucket);
  }

  const projectTop = (project: string): number => {
    const bucket = bucketsByProject.get(project);
    if (!bucket) {
      return Number.POSITIVE_INFINITY;
    }

    const nodeIds = [...bucket.fileIds, ...bucket.actionIds, ...bucket.queryIds];
    return nodeIds.reduce((minY, nodeId) => {
      const y = layoutNodeById.get(nodeId)?.position.y ?? Number.POSITIVE_INFINITY;
      return Math.min(minY, y);
    }, Number.POSITIVE_INFINITY);
  };

  const projectOrder = [...bucketsByProject.keys()].sort((projectA, projectB) => {
    const topA = projectTop(projectA);
    const topB = projectTop(projectB);
    if (topA !== topB) {
      return topA - topB;
    }

    return projectA.localeCompare(projectB);
  });

  const rowNodeIds = nodes
    .map((node) => graphNodeById.get(node.id))
    .filter((graphNode): graphNode is GraphNode => Boolean(graphNode))
    .filter((graphNode) => graphNode.kind === 'file' || graphNode.kind === 'action' || graphNode.kind === 'queryKey')
    .filter((graphNode) => !(graphNode.kind === 'action' && isDeclareActionNode(graphNode)))
    .map((graphNode) => graphNode.id);
  const maxRowNodeHeight = rowNodeIds.reduce((maxHeight, nodeId) => {
    const node = layoutNodeById.get(nodeId);
    if (!node) {
      return maxHeight;
    }

    const nodeHeight = node.measured?.height ?? node.height ?? DEFAULT_NODE_HEIGHT;
    return Math.max(maxHeight, nodeHeight);
  }, DEFAULT_NODE_HEIGHT);
  const rowStep = maxRowNodeHeight + resolveVerticalRowGap(verticalSpacing);

  const yByNodeId = new Map<string, number>();
  let globalCursor = projectOrder.reduce(
    (minY, project) => Math.min(minY, projectTop(project)),
    Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(globalCursor)) {
    globalCursor = 0;
  }

  for (const project of projectOrder) {
    const bucket = bucketsByProject.get(project);
    if (!bucket) {
      continue;
    }

    const sortedActions = [...bucket.actionIds].sort((actionIdA, actionIdB) =>
      compareActionOrder(
        graphNodeById.get(actionIdA),
        graphNodeById.get(actionIdB),
        layoutNodeById.get(actionIdA),
        layoutNodeById.get(actionIdB),
      ),
    );
    const sortedQueries = [...bucket.queryIds].sort((queryIdA, queryIdB) => {
      const queryNodeA = graphNodeById.get(queryIdA);
      const queryNodeB = graphNodeById.get(queryIdB);
      const impactDiff =
        Number(queryNodeB?.metrics?.affectedFiles ?? 0) - Number(queryNodeA?.metrics?.affectedFiles ?? 0);
      if (impactDiff !== 0) {
        return impactDiff;
      }

      const yA = layoutNodeById.get(queryIdA)?.position.y ?? 0;
      const yB = layoutNodeById.get(queryIdB)?.position.y ?? 0;
      if (yA !== yB) {
        return yA - yB;
      }

      const labelA = queryNodeA?.label ?? queryIdA;
      const labelB = queryNodeB?.label ?? queryIdB;
      return labelA.localeCompare(labelB);
    });
    const sortedFiles = [...bucket.fileIds].sort((fileIdA, fileIdB) => {
      const fileNodeA = graphNodeById.get(fileIdA);
      const fileNodeB = graphNodeById.get(fileIdB);
      const impactDiff = fileImpactForNode(fileNodeB) - fileImpactForNode(fileNodeA);
      if (impactDiff !== 0) {
        return impactDiff;
      }

      const yA = layoutNodeById.get(fileIdA)?.position.y ?? 0;
      const yB = layoutNodeById.get(fileIdB)?.position.y ?? 0;
      if (yA !== yB) {
        return yA - yB;
      }

      const labelA = fileNodeA?.label ?? fileIdA;
      const labelB = fileNodeB?.label ?? fileIdB;
      return labelA.localeCompare(labelB);
    });

    const projectStartY = globalCursor;
    const bucketActionSet = new Set(bucket.actionIds);
    const assignedActionIds = new Set<string>();
    let consumedRows = 0;

    for (const fileId of sortedFiles) {
      const linkedActionIds = [...new Set(actionIdsByFile.get(fileId) ?? [])]
        .filter((actionId) => bucketActionSet.has(actionId))
        .filter((actionId) => !assignedActionIds.has(actionId))
        .sort((actionIdA, actionIdB) =>
          compareActionOrder(
            graphNodeById.get(actionIdA),
            graphNodeById.get(actionIdB),
            layoutNodeById.get(actionIdA),
            layoutNodeById.get(actionIdB),
          ),
        );

      const spanRows = Math.max(linkedActionIds.length, 1);
      const fileRow = consumedRows + Math.floor((spanRows - 1) / 2);
      yByNodeId.set(fileId, projectStartY + fileRow * rowStep);

      for (const [actionIndex, actionId] of linkedActionIds.entries()) {
        yByNodeId.set(actionId, projectStartY + (consumedRows + actionIndex) * rowStep);
        assignedActionIds.add(actionId);
      }

      consumedRows += spanRows;
    }

    const orphanActionIds = sortedActions.filter((actionId) => !assignedActionIds.has(actionId));
    for (const actionId of orphanActionIds) {
      yByNodeId.set(actionId, projectStartY + consumedRows * rowStep);
      consumedRows += 1;
    }

    const rowCount = Math.max(consumedRows, sortedQueries.length, 1);
    for (const [rowIndex, queryId] of sortedQueries.entries()) {
      yByNodeId.set(queryId, projectStartY + rowIndex * rowStep);
    }

    globalCursor = projectStartY + (rowCount - 1) * rowStep + maxRowNodeHeight + FILE_ACTION_PROJECT_GAP;
  }

  return nodes.map((node) => {
    const nextY = yByNodeId.get(node.id);
    if (typeof nextY !== 'number') {
      return node;
    }

    return {
      ...node,
      position: {
        x: node.position.x,
        y: nextY,
      },
    };
  });
}

function nodeCenterYMap(nodes: Node[]): Map<string, number> {
  const centerYById = new Map<string, number>();
  for (const node of nodes) {
    const nodeHeight = node.measured?.height ?? node.height ?? DEFAULT_NODE_HEIGHT;
    centerYById.set(node.id, node.position.y + nodeHeight / 2);
  }

  return centerYById;
}

function nodeCenterXMap(nodes: Node[]): Map<string, number> {
  const centerXById = new Map<string, number>();
  for (const node of nodes) {
    const nodeWidth = node.measured?.width ?? node.width ?? 340;
    centerXById.set(node.id, node.position.x + nodeWidth / 2);
  }

  return centerXById;
}

function edgeRelationKey(edge: Edge): string {
  const edgeData = edge.data as FlowEdgeData | undefined;
  return edgeData?.relation ?? 'invalidates';
}

function relationLaneBand(relation: string): number {
  if (relation === 'declares') {
    return -132;
  }
  if (relation === 'sets') {
    return 140;
  }
  if (relation === 'removes') {
    return 112;
  }
  if (relation === 'resets') {
    return 84;
  }
  if (relation === 'clears') {
    return 28;
  }
  if (relation === 'cancels') {
    return -56;
  }
  if (relation === 'refetches') {
    return -28;
  }
  if (relation === 'invalidates') {
    return -84;
  }

  return 0;
}

function assignLaneOffsetsByGroup(
  groupedEdges: Map<string, Edge[]>,
  sortFn: (edgeA: Edge, edgeB: Edge) => number,
  step: number,
): Map<string, number> {
  const laneByEdgeId = new Map<string, number>();

  for (const group of groupedEdges.values()) {
    const sorted = [...group].sort(sortFn);
    const centerIndex = (sorted.length - 1) / 2;
    for (const [index, edge] of sorted.entries()) {
      laneByEdgeId.set(edge.id, (index - centerIndex) * step);
    }
  }

  return laneByEdgeId;
}

function resolveLaneCollisions(nodes: Node[], edges: Edge[]): Edge[] {
  const centerXById = nodeCenterXMap(nodes);
  const buckets = new Map<string, Edge[]>();

  for (const edge of edges) {
    const edgeData = edge.data as FlowEdgeData | undefined;
    const laneOffset = Number(edgeData?.laneOffset ?? 0);
    const relation = edgeRelationKey(edge);
    const sourceColumn = Math.round((centerXById.get(edge.source) ?? 0) / LANE_COLUMN_BUCKET_SIZE);
    const targetColumn = Math.round((centerXById.get(edge.target) ?? 0) / LANE_COLUMN_BUCKET_SIZE);
    const laneBucket = Math.round(laneOffset / LANE_VALUE_BUCKET_SIZE);
    const key = `${relation}:${sourceColumn}:${targetColumn}:${laneBucket}`;
    const group = buckets.get(key) ?? [];
    group.push(edge);
    buckets.set(key, group);
  }

  const laneDeltaByEdgeId = new Map<string, number>();
  for (const group of buckets.values()) {
    if (group.length < 2) {
      continue;
    }

    const sorted = [...group].sort(
      (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.id.localeCompare(b.id),
    );
    const centerIndex = (sorted.length - 1) / 2;
    for (const [index, edge] of sorted.entries()) {
      const delta = (index - centerIndex) * LANE_COLLISION_SPREAD;
      if (delta !== 0) {
        laneDeltaByEdgeId.set(edge.id, delta);
      }
    }
  }

  if (laneDeltaByEdgeId.size === 0) {
    return edges;
  }

  return edges.map((edge) => {
    const laneDelta = laneDeltaByEdgeId.get(edge.id);
    if (typeof laneDelta !== 'number') {
      return edge;
    }

    const edgeData = edge.data as FlowEdgeData | undefined;
    return {
      ...edge,
      data: {
        relation: edgeData?.relation ?? (edgeRelationKey(edge) as FlowEdgeData['relation']),
        dim: edgeData?.dim ?? false,
        highlighted: edgeData?.highlighted ?? false,
        laneOffset: Number(edgeData?.laneOffset ?? 0) + laneDelta,
      } satisfies FlowEdgeData,
    };
  });
}

function applyEdgeGeometryLanes(nodes: Node[], edges: Edge[]): Edge[] {
  const centerYById = nodeCenterYMap(nodes);
  const groupedBySource = new Map<string, Edge[]>();
  const groupedByTarget = new Map<string, Edge[]>();

  for (const edge of edges) {
    const relation = edgeRelationKey(edge);

    const sourceKey = `${edge.source}:${relation}`;
    const sourceList = groupedBySource.get(sourceKey) ?? [];
    sourceList.push(edge);
    groupedBySource.set(sourceKey, sourceList);

    const targetKey = `${edge.target}:${relation}`;
    const targetList = groupedByTarget.get(targetKey) ?? [];
    targetList.push(edge);
    groupedByTarget.set(targetKey, targetList);
  }

  const sourceLaneByEdgeId = assignLaneOffsetsByGroup(
    groupedBySource,
    (a, b) => {
      const aY = centerYById.get(a.target) ?? 0;
      const bY = centerYById.get(b.target) ?? 0;
      if (aY !== bY) {
        return aY - bY;
      }

      return a.id.localeCompare(b.id);
    },
    58,
  );

  const targetLaneByEdgeId = assignLaneOffsetsByGroup(
    groupedByTarget,
    (a, b) => {
      const aY = centerYById.get(a.source) ?? 0;
      const bY = centerYById.get(b.source) ?? 0;
      if (aY !== bY) {
        return aY - bY;
      }

      return a.id.localeCompare(b.id);
    },
    58,
  );

  const laneAdjustedEdges = edges.map((edge) => {
    const relation = edgeRelationKey(edge);
    const sourceLane = sourceLaneByEdgeId.get(edge.id) ?? 0;
    const targetLane = targetLaneByEdgeId.get(edge.id) ?? 0;
    const laneOffset = sourceLane + targetLane + relationLaneBand(relation);
    const edgeData = edge.data as FlowEdgeData | undefined;

    return {
      ...edge,
      data: {
        relation: edgeData?.relation ?? (relation as FlowEdgeData['relation']),
        dim: edgeData?.dim ?? false,
        highlighted: edgeData?.highlighted ?? false,
        laneOffset,
      } satisfies FlowEdgeData,
    };
  });

  return resolveLaneCollisions(nodes, laneAdjustedEdges);
}

function minimumNodeY(nodes: Node[]): number | null {
  let minY = Number.POSITIVE_INFINITY;

  for (const node of nodes) {
    if (node.id.startsWith('divider:')) {
      continue;
    }
    minY = Math.min(minY, node.position.y);
  }

  if (!Number.isFinite(minY)) {
    return null;
  }

  return minY;
}

function buildSelectedTrail(
  graph: WebviewPayload['graph'],
  selectedNodeId: string | null,
): {
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
} {
  const highlightedNodeIds = new Set<string>();
  const highlightedEdgeIds = new Set<string>();
  if (!selectedNodeId) {
    return { highlightedNodeIds, highlightedEdgeIds };
  }

  const hasSelectedNode = graph.nodes.some((node) => node.id === selectedNodeId);
  if (!hasSelectedNode) {
    return { highlightedNodeIds, highlightedEdgeIds };
  }

  const incoming = new Map<string, WebviewPayload['graph']['edges']>();
  const outgoing = new Map<string, WebviewPayload['graph']['edges']>();
  for (const edge of graph.edges) {
    const incomingList = incoming.get(edge.target) ?? [];
    incomingList.push(edge);
    incoming.set(edge.target, incomingList);

    const outgoingList = outgoing.get(edge.source) ?? [];
    outgoingList.push(edge);
    outgoing.set(edge.source, outgoingList);
  }

  highlightedNodeIds.add(selectedNodeId);

  const walk = (direction: 'up' | 'down') => {
    const stack = [selectedNodeId];
    const visited = new Set<string>([selectedNodeId]);

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      const edges = direction === 'up' ? (incoming.get(current) ?? []) : (outgoing.get(current) ?? []);
      for (const edge of edges) {
        highlightedEdgeIds.add(edge.id);
        const nextId = direction === 'up' ? edge.source : edge.target;
        highlightedNodeIds.add(nextId);
        if (visited.has(nextId)) {
          continue;
        }

        visited.add(nextId);
        stack.push(nextId);
      }
    }
  };

  walk('up');
  walk('down');

  return { highlightedNodeIds, highlightedEdgeIds };
}

export function GraphCanvas({ payload }: { payload: WebviewPayload }) {
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [verticalSpacing, setVerticalSpacing] = useState<number>(() =>
    clampVerticalSpacing(payload.layout.verticalSpacing),
  );
  const [horizontalSpacing, setHorizontalSpacing] = useState<number>(() =>
    clampHorizontalSpacing(payload.layout.horizontalSpacing),
  );

  const { shellRef, shellStyle, activeResizer, startResize } = useResizablePanels();

  const relationFilteredGraph = useMemo(() => computeVisibleGraph(payload.graph, filters), [payload.graph, filters]);
  const searchFilteredGraph = useMemo(
    () => applySearchFilter(relationFilteredGraph, filters.search),
    [relationFilteredGraph, filters.search],
  );
  const visible = useMemo(() => collapseGraphIfLarge(searchFilteredGraph).graph, [searchFilteredGraph]);
  const isMultiProject = useMemo(() => countProjects(visible) > 1, [visible]);
  const isMonorepo = useMemo(() => isMonorepoGraph(payload.graph), [payload.graph]);
  const queryKeys = useMemo(
    () =>
      [...new Set(visible.nodes.filter((node) => node.kind === 'queryKey').map((node) => node.label))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [visible.nodes],
  );
  const relatedFiles = useMemo(() => buildRelatedFiles(payload.scannedFiles, visible), [payload.scannedFiles, visible]);
  const queryCallsiteImpactById = useMemo(() => buildQueryCallsiteImpactMap(visible), [visible]);
  const selectedTrail = useMemo(() => buildSelectedTrail(visible, selectedId), [visible, selectedId]);
  const flowGraph = useMemo(
    () =>
      buildFlowGraph(visible, filters.search, {
        highlightedNodeIds: selectedTrail.highlightedNodeIds,
        highlightedEdgeIds: selectedTrail.highlightedEdgeIds,
        selectedNodeId: selectedId,
      }),
    [visible, filters.search, selectedTrail, selectedId],
  );
  const latestFlowGraphRef = useRef(flowGraph);
  const layoutFlowGraph = useMemo(
    () =>
      buildFlowGraph(visible, '', {
        highlightedNodeIds: new Set<string>(),
        highlightedEdgeIds: new Set<string>(),
        selectedNodeId: null,
      }),
    [visible],
  );
  const layoutNodes = useMemo(
    () => orderNodesForLayout(layoutFlowGraph.nodes, visible, queryCallsiteImpactById),
    [layoutFlowGraph.nodes, visible, queryCallsiteImpactById],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const reactFlow = useReactFlow();
  const selectedNode = visible.nodes.find((node) => node.id === selectedId) ?? null;

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      rqvNode: RqvFlowNode,
      rqvDivider: ProjectDividerNode,
    }),
    [],
  );

  useEffect(() => {
    latestFlowGraphRef.current = flowGraph;
  }, [flowGraph]);

  useEffect(() => {
    if (nodes.length === 0 && edges.length === 0) {
      return;
    }

    const flowNodeById = new Map(flowGraph.nodes.map((node) => [node.id, node]));
    setNodes((previous) =>
      previous.map((node) => {
        if (node.id.startsWith('divider:')) {
          return node;
        }

        const next = flowNodeById.get(node.id);
        if (!next) {
          return node;
        }

        return {
          ...node,
          data: next.data,
          style: {
            ...node.style,
            ...next.style,
          },
        };
      }),
    );

    const flowEdgeById = new Map(flowGraph.edges.map((edge) => [edge.id, edge]));
    setEdges((previous) =>
      previous.map((edge) => {
        const next = flowEdgeById.get(edge.id);
        if (!next) {
          return edge;
        }

        return {
          ...edge,
          type: next.type,
          sourceHandle: next.sourceHandle,
          targetHandle: next.targetHandle,
          data: next.data,
          style: next.style,
        };
      }),
    );
  }, [flowGraph.nodes, flowGraph.edges, nodes.length, edges.length, setNodes, setEdges]);

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      const compactVerticalSpacing = clampVerticalSpacing(verticalSpacing);
      const wideHorizontalSpacing = clampHorizontalSpacing(horizontalSpacing);
      const layouted = getLayoutedElements(layoutNodes, layoutFlowGraph.edges, {
        direction: 'LR',
        verticalSpacing: compactVerticalSpacing,
        horizontalSpacing: wideHorizontalSpacing,
      });
      const spacedNodes = applyProjectBandSpacing(layouted.nodes, visible, isMultiProject);
      const groupedNodes = alignFileActionGroups(spacedNodes, visible, compactVerticalSpacing);
      const topAlignedNodes = alignQueryNodesNearSources(
        groupedNodes,
        visible,
        queryCallsiteImpactById,
        compactVerticalSpacing,
      );
      const rightAlignedQueryNodes = alignQueryNodesToRightColumn(topAlignedNodes, visible, isMonorepo);
      const leftPlacedDeclareNodes = alignDeclareNodesLeftOfQuery(rightAlignedQueryNodes, visible);
      const projectPositionedNodes = arrangeProjectsHorizontally(leftPlacedDeclareNodes, visible, isMonorepo);
      const alignedEdges = applyEdgeGeometryLanes(projectPositionedNodes, layouted.edges);
      const projectDividers = buildProjectDividerNodes(projectPositionedNodes, visible, isMultiProject, isMonorepo);
      const currentFlowGraph = latestFlowGraphRef.current;
      const currentFlowNodeById = new Map(currentFlowGraph.nodes.map((node) => [node.id, node]));
      const currentFlowEdgeById = new Map(currentFlowGraph.edges.map((edge) => [edge.id, edge]));

      const layoutedNodesWithCurrentVisuals = projectPositionedNodes.map((node) => {
        const currentNode = currentFlowNodeById.get(node.id);
        if (!currentNode) {
          return node;
        }

        return {
          ...node,
          data: currentNode.data,
          style: {
            ...node.style,
            ...currentNode.style,
          },
        };
      });

      const alignedEdgesWithCurrentVisuals = alignedEdges.map((edge) => {
        const currentEdge = currentFlowEdgeById.get(edge.id);
        if (!currentEdge) {
          return edge;
        }

        const alignedData = edge.data as FlowEdgeData | undefined;
        const currentData = currentEdge.data as FlowEdgeData | undefined;

        return {
          ...edge,
          type: currentEdge.type,
          sourceHandle: currentEdge.sourceHandle,
          targetHandle: currentEdge.targetHandle,
          data: {
            relation: currentData?.relation ?? alignedData?.relation ?? 'invalidates',
            dim: currentData?.dim ?? alignedData?.dim ?? false,
            highlighted: currentData?.highlighted ?? alignedData?.highlighted ?? false,
            laneOffset: Number(alignedData?.laneOffset ?? currentData?.laneOffset ?? 0),
          } satisfies FlowEdgeData,
          style: currentEdge.style,
          className: currentEdge.className,
          animated: currentEdge.animated,
        };
      });

      const layoutedWithDividers = [...projectDividers, ...layoutedNodesWithCurrentVisuals];

      setNodes(layoutedWithDividers);
      setEdges(alignedEdgesWithCurrentVisuals);

      reactFlow
        .fitView({ padding: 0.1, duration: 180 })
        .then(() => {
          if (cancelled) {
            return;
          }

          const minY = minimumNodeY(layoutedWithDividers);
          if (minY === null) {
            return;
          }

          const viewport = reactFlow.getViewport();
          const alignedY = 28 - minY * viewport.zoom;
          reactFlow
            .setViewport(
              {
                x: viewport.x,
                y: alignedY,
                zoom: viewport.zoom,
              },
              { duration: 120 },
            )
            .then(undefined, () => undefined);
        })
        .then(undefined, () => undefined);
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [
    layoutNodes,
    layoutFlowGraph.edges,
    verticalSpacing,
    horizontalSpacing,
    reactFlow,
    setEdges,
    setNodes,
    visible,
    isMultiProject,
    isMonorepo,
    queryCallsiteImpactById,
  ]);

  const onNodeClick: NodeMouseHandler = (_, node) => {
    if (node.id.startsWith('divider:')) {
      return;
    }
    setSelectedId(node.id);
  };

  const onSelectRelatedFile = (filePath: string) => {
    const fileNode = visible.nodes.find((node) => node.kind === 'file' && node.label === filePath);
    if (!fileNode) {
      return;
    }

    setSelectedId(fileNode.id);
  };

  const onSelectQueryKey = (queryKeyLabel: string) => {
    const candidateQueryNodes = visible.nodes.filter(
      (node) => node.kind === 'queryKey' && node.label === queryKeyLabel,
    );
    if (candidateQueryNodes.length === 0) {
      return;
    }

    const currentlySelected =
      selectedNode?.kind === 'queryKey' &&
      selectedNode.label === queryKeyLabel &&
      candidateQueryNodes.some((candidate) => candidate.id === selectedNode.id)
        ? selectedNode.id
        : null;

    if (currentlySelected) {
      setSelectedId(currentlySelected);
      return;
    }

    const layoutNodeById = new Map(nodes.map((node) => [node.id, node]));
    const [targetNode] = [...candidateQueryNodes].sort((a, b) => {
      const layoutA = layoutNodeById.get(a.id);
      const layoutB = layoutNodeById.get(b.id);

      if (layoutA && layoutB) {
        if (layoutA.position.y !== layoutB.position.y) {
          return layoutA.position.y - layoutB.position.y;
        }

        if (layoutA.position.x !== layoutB.position.x) {
          return layoutA.position.x - layoutB.position.x;
        }
      } else if (layoutA) {
        return -1;
      } else if (layoutB) {
        return 1;
      }

      const impactDiff = Number(b.metrics?.affectedFiles ?? 0) - Number(a.metrics?.affectedFiles ?? 0);
      if (impactDiff !== 0) {
        return impactDiff;
      }

      return a.id.localeCompare(b.id);
    });

    if (!targetNode) {
      return;
    }

    setSelectedId(targetNode.id);
  };

  const setFiltersAndClearSelection = (nextFilters: SetStateAction<FilterState>) => {
    setSelectedId(null);
    setFilters(nextFilters);
  };

  const onNodeDoubleClick: NodeMouseHandler = (_, node) => {
    if (node.id.startsWith('divider:')) {
      return;
    }

    const original = visible.nodes.find((value) => value.id === node.id);
    if (!original) {
      return;
    }

    revealNodeInCode(original);
  };

  const explanation = useMemo(
    () => buildNodeExplanation(visible, selectedNode, payload.graph),
    [visible, selectedNode, payload.graph],
  );

  return (
    <div
      ref={shellRef}
      className={cx(
        'rqv-theme flex h-full w-full min-w-0 bg-zinc-100 text-zinc-900 [font-family:Space_Grotesk,Segoe_UI,sans-serif] dark:bg-zinc-950 dark:text-zinc-100',
        activeResizer && 'cursor-col-resize select-none [&_*]:cursor-col-resize [&_*]:select-none',
      )}
      style={shellStyle}
    >
      <LeftPanel
        filters={filters}
        setFilters={setFiltersAndClearSelection}
        queryKeys={queryKeys}
        selectedQueryKey={selectedNode?.kind === 'queryKey' ? selectedNode.label : null}
        onSelectQueryKey={onSelectQueryKey}
        relatedFiles={relatedFiles}
        verticalSpacing={verticalSpacing}
        onVerticalSpacingChange={(value) => setVerticalSpacing(clampVerticalSpacing(value))}
        horizontalSpacing={horizontalSpacing}
        onHorizontalSpacingChange={(value) => setHorizontalSpacing(clampHorizontalSpacing(value))}
        showProjectDividers={isMultiProject}
        selectedRelatedFilePath={selectedNode?.kind === 'file' ? selectedNode.label : null}
        onSelectRelatedFile={onSelectRelatedFile}
      />

      <ResizeDivider onPointerDown={startResize('left')} />

      <main className="h-full min-w-0 grow basis-0">
        <ReactFlow
          className="bg-zinc-100 dark:bg-zinc-950 [&_.react-flow__controls]:shadow-[0_4px_16px_rgba(0,0,0,0.22)] [&_.react-flow__edge-textbg]:fill-[rgba(250,250,250,0.88)] dark:[&_.react-flow__edge-textbg]:fill-[rgba(24,24,27,0.92)] [&_.react-flow__edge-text]:font-bold"
          proOptions={{ hideAttribution: true }}
          nodeTypes={nodeTypes}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={() => setSelectedId(null)}
          connectionLineType={ConnectionLineType.Bezier}
          fitView
          minZoom={0.24}
          maxZoom={2.2}
        >
          <Controls />
          <MiniMap
            position="bottom-right"
            zoomable
            pannable
            nodeStrokeWidth={3}
            nodeColor="var(--rqv-minimap-node)"
            maskColor="var(--rqv-minimap-mask)"
            style={{
              width: 132,
              height: 88,
              background: 'var(--rqv-minimap-bg)',
              border: '1px solid var(--rqv-minimap-border)',
              borderRadius: 10,
              boxShadow: '0 8px 20px var(--rqv-minimap-shadow)',
              marginRight: 10,
              marginBottom: 10,
            }}
          />
          <Background variant={BackgroundVariant.Lines} gap={44} size={0.48} color="var(--rqv-grid-color)" />
        </ReactFlow>
      </main>

      <ResizeDivider hiddenOnSmall onPointerDown={startResize('right')} />

      <RightPanel
        selectedNode={selectedNode}
        explanation={explanation}
        onReveal={revealNodeInCode}
        onRevealFile={revealFileInCode}
        onRevealCallsite={revealCallsiteInCode}
      />
    </div>
  );
}
