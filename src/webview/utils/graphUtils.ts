import type { Edge, Node } from '@xyflow/react';

import type { HighlightState } from './shared';
import type { GraphData, GraphNode } from '../types/model';
import type { FilterState, NodeExplanation } from '../types/viewTypes';
import { collapseGraphIfLarge as collapseGraphIfLargeImpl } from '../layout/collapseGraphIfLarge';
import { applySearchFilter as applySearchFilterImpl, computeVisibleGraph as computeVisibleGraphImpl } from './filters';
import { buildFlowGraph as buildFlowGraphImpl } from './flowGraph';
import { buildNodeExplanation as buildNodeExplanationImpl } from './nodeExplanation';

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
