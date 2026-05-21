import type { Node } from '@xyflow/react';

import { orderNodesForLayout as orderNodesForLayoutImpl } from './layoutOrdering';
import {
  arrangeProjectsHorizontally as arrangeProjectsHorizontallyImpl,
  isMonorepoGraph as isMonorepoGraphImpl,
} from './projectArrangement';
import { applyProjectBandSpacing as applyProjectBandSpacingImpl } from './projectDividers';
import {
  alignDeclareNodesLeftOfQuery as alignDeclareNodesLeftOfQueryImpl,
  alignQueryNodesNearSources as alignQueryNodesNearSourcesImpl,
  alignQueryNodesToRightColumn as alignQueryNodesToRightColumnImpl,
} from './queryAlignment';
import type { WebviewPayload } from '../types/model';
import { alignFileActionGroups as alignFileActionGroupsImpl } from '../utils/fileActionGroups';

export function isMonorepoGraph(graph: WebviewPayload['graph']): boolean {
  return isMonorepoGraphImpl(graph);
}

export function orderNodesForLayout(
  nodes: Node[],
  graph: WebviewPayload['graph'],
  queryCallsiteImpactById: Map<string, number>,
): Node[] {
  return orderNodesForLayoutImpl(nodes, graph, queryCallsiteImpactById);
}

export function alignQueryNodesNearSources(
  nodes: Node[],
  graph: WebviewPayload['graph'],
  queryCallsiteImpactById: Map<string, number>,
  verticalSpacing: number,
): Node[] {
  return alignQueryNodesNearSourcesImpl(nodes, graph, queryCallsiteImpactById, verticalSpacing);
}

export function alignQueryNodesToRightColumn(
  nodes: Node[],
  graph: WebviewPayload['graph'],
  groupByProject = false,
): Node[] {
  return alignQueryNodesToRightColumnImpl(nodes, graph, groupByProject);
}

export function alignDeclareNodesLeftOfQuery(nodes: Node[], graph: WebviewPayload['graph']): Node[] {
  return alignDeclareNodesLeftOfQueryImpl(nodes, graph);
}

export function arrangeProjectsHorizontally(nodes: Node[], graph: WebviewPayload['graph'], enabled: boolean): Node[] {
  return arrangeProjectsHorizontallyImpl(nodes, graph, enabled);
}

export function alignFileActionGroups(nodes: Node[], graph: WebviewPayload['graph'], verticalSpacing: number): Node[] {
  return alignFileActionGroupsImpl(nodes, graph, verticalSpacing);
}

export function applyProjectBandSpacing(
  layoutedNodes: Node[],
  graph: WebviewPayload['graph'],
  keepFirstDivider: boolean,
): Node[] {
  return applyProjectBandSpacingImpl(layoutedNodes, graph, keepFirstDivider);
}
