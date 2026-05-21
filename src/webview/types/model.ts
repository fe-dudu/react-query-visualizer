export type GraphNodeKind = 'file' | 'action' | 'queryKey';
export type GraphRelation =
  | 'declares'
  | 'invalidates'
  | 'refetches'
  | 'cancels'
  | 'resets'
  | 'clears'
  | 'removes'
  | 'sets';
export type OperationRelation = 'invalidates' | 'refetches' | 'cancels' | 'resets' | 'clears' | 'removes' | 'sets';
export type Resolution = 'static' | 'dynamic';

export interface SourceLoc {
  line: number;
  column: number;
}

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  file?: string;
  loc?: SourceLoc;
  resolution: Resolution;
  metrics?: Record<string, number | string>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: GraphRelation;
  resolution: Resolution;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  summary: {
    files: number;
    actions: number;
    queryKeys: number;
    parseErrors: number;
  };
  parseErrors: Array<{
    file: string;
    message: string;
  }>;
}

export interface ScannedFile {
  path: string;
  workspace: string;
  depth: number;
  project?: string;
  projectRelativePath?: string;
  impact?: number;
}

export interface LayoutConfig {
  direction: 'LR';
  engine: 'dagre';
  verticalSpacing: number;
  horizontalSpacing: number;
}

export interface WebviewPayload {
  graph: GraphData;
  scannedFiles: ScannedFile[];
  scopeLabel: string;
  layout: LayoutConfig;
}
