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

export type Resolution = 'static' | 'dynamic';

export type MatchMode = 'exact' | 'prefix' | 'all' | 'predicate' | 'unknown';

export interface SourceLoc {
  line: number;
  column: number;
}

export interface NormalizedQueryKey {
  id: string;
  display: string;
  segments: string[];
  matchMode: MatchMode;
  resolution: Resolution;
  source: 'literal' | 'expression' | 'wildcard';
}

export interface ScanScope {
  folders: string[];
  includeGlob: string;
  excludeGlob: string;
  useGitIgnore: boolean;
  maxFileSizeKB: number;
}

export interface QueryRecord {
  relation: GraphRelation;
  operation: string;
  file: string;
  loc: SourceLoc;
  queryKey: NormalizedQueryKey;
  resolution: Resolution;
  declaresDirectly?: boolean;
}

export interface AnalysisResult {
  records: QueryRecord[];
  scannedFiles: string[];
  filesScanned: number;
  parseErrors: Array<{
    file: string;
    message: string;
  }>;
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

export interface LayoutConfig {
  direction: 'LR';
  engine: 'dagre';
  verticalSpacing: number;
  horizontalSpacing: number;
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
}

export interface WebviewPayload {
  graph: GraphData;
  scannedFiles: ScannedFile[];
  scopeLabel: string;
  layout: LayoutConfig;
}
