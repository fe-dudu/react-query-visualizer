import type { GraphNode, GraphRelation, OperationRelation } from './model';

export interface FilterState {
  relation: Record<OperationRelation, boolean>;
  fileQuery: string;
  search: string;
}

export interface FlowNodeData extends Record<string, unknown> {
  node: GraphNode;
  title: string;
  subtitle: string;
  relation?: GraphRelation;
  dim: boolean;
  highlighted: boolean;
  selected: boolean;
}

export interface FlowEdgeData extends Record<string, unknown> {
  relation: GraphRelation;
  dim: boolean;
  highlighted: boolean;
  laneOffset: number;
}

export interface DividerNodeData extends Record<string, unknown> {
  label: string;
  width: number;
  height?: number;
  showLabel?: boolean;
  variant?: 'line' | 'bubble';
}

export interface NodeCallsite {
  label: string;
  file?: string;
  line?: number;
  column?: number;
  relation?: OperationRelation;
}

export interface NodeFileRef {
  label: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface NodeExplanation {
  summary: string;
  files: NodeFileRef[];
  actions: NodeCallsite[];
  declarations: NodeCallsite[];
  queryKeys: string[];
}
