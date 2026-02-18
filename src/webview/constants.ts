import type { GraphData, GraphNode, GraphRelation, OperationRelation, WebviewPayload } from './model';

export const RELATION_LABEL: Record<GraphRelation, string> = {
  declares: 'Declare',
  invalidates: 'Invalidate',
  refetches: 'Refetch',
  cancels: 'Cancel',
  resets: 'Reset',
  clears: 'Clear',
  removes: 'Remove',
  sets: 'Set',
};

export const OPERATION_RELATIONS: OperationRelation[] = [
  'invalidates',
  'refetches',
  'cancels',
  'resets',
  'removes',
  'sets',
  'clears',
];

export const RELATION_COLOR: Record<GraphRelation, string> = {
  declares: '#a1a1aa',
  invalidates: '#f97316',
  refetches: '#22c55e',
  cancels: '#0ea5e9',
  resets: '#14b8a6',
  removes: '#f43f5e',
  sets: '#3b82f6',
  clears: '#ef4444',
};

export const RELATION_BADGE_CLASS: Record<GraphRelation, string> = {
  declares: 'bg-zinc-500',
  invalidates: 'bg-orange-500',
  refetches: 'bg-emerald-500',
  cancels: 'bg-sky-500',
  resets: 'bg-teal-500',
  removes: 'bg-rose-500',
  sets: 'bg-blue-500',
  clears: 'bg-red-500',
};

export const SHARED_SOURCE_HANDLE_ID = 'source-main';
export const SHARED_TARGET_HANDLE_ID = 'target-main';

export type VisualNodeKind = GraphNode['kind'] | 'declare';

export const NODE_SURFACE_CLASS: Record<VisualNodeKind, string> = {
  file: 'bg-zinc-100 border-zinc-300 dark:bg-zinc-800 dark:border-zinc-600',
  action: 'bg-zinc-100 border-zinc-400 dark:bg-zinc-900 dark:border-zinc-700',
  queryKey: 'bg-zinc-200 border-zinc-400 dark:bg-zinc-800 dark:border-zinc-600',
  declare: 'bg-zinc-50 border-zinc-400 dark:bg-zinc-900 dark:border-zinc-500',
};

export const EMPTY_GRAPH: GraphData = {
  nodes: [],
  edges: [],
  summary: {
    files: 0,
    actions: 0,
    queryKeys: 0,
    parseErrors: 0,
  },
  parseErrors: [],
};

export const defaultPayload: WebviewPayload = {
  graph: EMPTY_GRAPH,
  scannedFiles: [],
  scopeLabel: 'No scan has run yet',
  layout: {
    direction: 'LR',
    engine: 'dagre',
    verticalSpacing: 30,
    horizontalSpacing: 500,
  },
};

export const MIN_LEFT_PANEL = 220;
export const MAX_LEFT_PANEL = 560;
export const MIN_RIGHT_PANEL = 160;
export const MAX_RIGHT_PANEL = 760;
export const MIN_CANVAS_WIDTH = 440;
export const RESIZER_WIDTH = 8;
