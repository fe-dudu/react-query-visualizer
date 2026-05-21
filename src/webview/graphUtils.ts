import type { Edge, Node } from '@xyflow/react';

import type { HighlightState } from './graphUtils/shared';
import type { GraphData, GraphNode } from './model';
import type { FilterState, NodeExplanation } from './viewTypes';
import { collapseGraphIfLarge as collapseGraphIfLargeImpl } from './graphUtils/collapseGraphIfLarge';
import {
  applySearchFilter as applySearchFilterImpl,
  computeVisibleGraph as computeVisibleGraphImpl,
} from './graphUtils/filters';
import { buildFlowGraph as buildFlowGraphImpl } from './graphUtils/flowGraph';
import { buildNodeExplanation as buildNodeExplanationImpl } from './graphUtils/nodeExplanation';

export function collapseGraphIfLarge(graph: GraphData, threshold = 800): { graph: GraphData; collapsed: boolean } {
  return collapseGraphIfLargeImpl(graph, threshold);
}

export function computeVisibleGraph(graph: GraphData, filters: FilterState): GraphData {
  return computeVisibleGraphImpl(graph, filters);
}

export function applySearchFilter(graph: GraphData, search: string): GraphData {
  return applySearchFilterImpl(graph, search);
}

export function buildFlowGraph(
  graph: GraphData,
  search: string,
  highlight?: HighlightState,
): { nodes: Node[]; edges: Edge[] } {
  return buildFlowGraphImpl(graph, search, highlight);
}

export function buildNodeExplanation(
  graph: GraphData,
  selectedNode: GraphNode | null,
  declarationGraph: GraphData = graph,
): NodeExplanation | null {
  return buildNodeExplanationImpl(graph, selectedNode, declarationGraph);
}
