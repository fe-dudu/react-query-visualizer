import { OPERATION_RELATIONS } from '../constants';
import type { GraphData, GraphNode, OperationRelation } from '../model';
import { nodeFileDisplay } from '../utils';
import type { NodeCallsite, NodeFileRef } from '../viewTypes';

export interface HighlightState {
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
  selectedNodeId: string | null;
}

const OPERATION_SORT_INDEX = new Map<OperationRelation, number>(
  OPERATION_RELATIONS.map((relation, index) => [relation, index]),
);

export function isOperationRelation(value: unknown): value is OperationRelation {
  return (
    value === 'invalidates' ||
    value === 'refetches' ||
    value === 'cancels' ||
    value === 'resets' ||
    value === 'clears' ||
    value === 'removes' ||
    value === 'sets'
  );
}

export function summarizeVisibleGraph(graph: GraphData): GraphData['summary'] {
  return {
    files: graph.nodes.filter((node) => node.kind === 'file').length,
    actions: graph.nodes.filter((node) => node.kind === 'action').length,
    queryKeys: graph.nodes.filter((node) => node.kind === 'queryKey').length,
    parseErrors: graph.parseErrors.length,
  };
}

export function nodeMatchesSearch(node: GraphNode, searchText: string): boolean {
  if (searchText.length === 0) {
    return true;
  }

  const target = `${node.label} ${nodeFileDisplay(node)}`.toLowerCase();
  return target.includes(searchText);
}

function actionRelation(actionNode: GraphNode): OperationRelation | null {
  const relation = actionNode.metrics?.relation;
  if (isOperationRelation(relation)) {
    return relation;
  }

  return null;
}

function actionOrder(actionNode: GraphNode): number {
  const relation = actionRelation(actionNode);
  if (!relation) {
    return OPERATION_RELATIONS.length + 1;
  }

  return OPERATION_SORT_INDEX.get(relation) ?? OPERATION_RELATIONS.length + 1;
}

export function sortActionNodesByOperation(actionNodes: GraphNode[]): GraphNode[] {
  return [...actionNodes].sort((a, b) => {
    const operationDiff = actionOrder(a) - actionOrder(b);
    if (operationDiff !== 0) {
      return operationDiff;
    }

    const fileDiff = nodeFileDisplay(a).localeCompare(nodeFileDisplay(b));
    if (fileDiff !== 0) {
      return fileDiff;
    }

    const lineDiff = (a.loc?.line ?? Number.MAX_SAFE_INTEGER) - (b.loc?.line ?? Number.MAX_SAFE_INTEGER);
    if (lineDiff !== 0) {
      return lineDiff;
    }

    const columnDiff = (a.loc?.column ?? Number.MAX_SAFE_INTEGER) - (b.loc?.column ?? Number.MAX_SAFE_INTEGER);
    if (columnDiff !== 0) {
      return columnDiff;
    }

    return a.label.localeCompare(b.label);
  });
}

export function actionLabel(actionNode: GraphNode): NodeCallsite {
  const file = nodeFileDisplay(actionNode);
  const relation = actionRelation(actionNode) ?? undefined;
  const line = actionNode.loc?.line;
  const column = actionNode.loc?.column;
  const loc = line && column ? `${line}:${column}` : '-';

  return {
    label: `${actionNode.label} in ${file} @ ${loc}`,
    file: actionNode.file,
    line,
    column,
    relation,
  };
}

export function fileRef(label: string, file?: string, line?: number, column?: number): NodeFileRef {
  return {
    label,
    file,
    line,
    column,
  };
}

export function sortFileRefs(files: NodeFileRef[]): NodeFileRef[] {
  return [...files].sort((a, b) => a.label.localeCompare(b.label));
}

export function sortCallsites(callsites: NodeCallsite[]): NodeCallsite[] {
  return [...callsites].sort((a, b) => {
    const fileA = a.file ?? '';
    const fileB = b.file ?? '';
    if (fileA !== fileB) {
      return fileA.localeCompare(fileB);
    }

    const lineDiff = (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);
    if (lineDiff !== 0) {
      return lineDiff;
    }

    const columnDiff = (a.column ?? Number.MAX_SAFE_INTEGER) - (b.column ?? Number.MAX_SAFE_INTEGER);
    if (columnDiff !== 0) {
      return columnDiff;
    }

    return a.label.localeCompare(b.label);
  });
}

function isPlaceholderOnlyQueryLabel(label: string): boolean {
  const normalized = label.trim();
  if (!normalized) {
    return false;
  }

  return normalized.startsWith('$') || normalized.startsWith('[$');
}

export function filterActionQueryLabels(labels: string[]): string[] {
  const deduped = [...new Set(labels)];
  const specificLabels = deduped.filter((label) => !isPlaceholderOnlyQueryLabel(label));
  if (specificLabels.length > 0) {
    return specificLabels;
  }

  return deduped;
}
