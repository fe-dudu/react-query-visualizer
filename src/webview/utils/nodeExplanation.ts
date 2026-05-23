import {
  actionLabel,
  fileRef,
  filterActionQueryLabels,
  sortActionNodesByOperation,
  sortCallsites,
  sortFileRefs,
} from './nodePresentation';
import { isDeclareActionNode, nodeFileDisplay, shortText } from './utils';
import type { GraphData, GraphNode } from '../../shared/contracts';
import type { NodeCallsite, NodeExplanation, NodeFileRef } from '../types/viewTypes';

function queryNodeGroupKey(node: GraphNode): string {
  const rootSegment = String(node.metrics?.rootSegment ?? node.label);
  const projectScope = String(node.metrics?.projectScope ?? '');
  return `${projectScope}::${rootSegment}`;
}

function collapseQueryNodes(queryNodes: GraphNode[]): GraphNode[] {
  const grouped = new Map<string, GraphNode[]>();

  for (const node of queryNodes) {
    const key = queryNodeGroupKey(node);
    const nodes = grouped.get(key);
    if (nodes) {
      nodes.push(node);
      continue;
    }

    grouped.set(key, [node]);
  }

  return [...grouped.values()]
    .map(
      (nodes) =>
        [...nodes].sort((left, right) => {
          const lengthDiff = left.label.length - right.label.length;
          if (lengthDiff !== 0) {
            return lengthDiff;
          }

          const lineDiff = (left.loc?.line ?? Number.MAX_SAFE_INTEGER) - (right.loc?.line ?? Number.MAX_SAFE_INTEGER);
          if (lineDiff !== 0) {
            return lineDiff;
          }

          const columnDiff =
            (left.loc?.column ?? Number.MAX_SAFE_INTEGER) - (right.loc?.column ?? Number.MAX_SAFE_INTEGER);
          if (columnDiff !== 0) {
            return columnDiff;
          }

          return left.label.localeCompare(right.label);
        })[0] as GraphNode,
    )
    .sort((left, right) => left.label.localeCompare(right.label));
}

function sortActionNodesByLocation(actionNodes: GraphNode[]): GraphNode[] {
  return [...actionNodes].sort((left, right) => {
    const fileDiff = (left.file ?? '').localeCompare(right.file ?? '');
    if (fileDiff !== 0) {
      return fileDiff;
    }

    const lineDiff = (left.loc?.line ?? Number.MAX_SAFE_INTEGER) - (right.loc?.line ?? Number.MAX_SAFE_INTEGER);
    if (lineDiff !== 0) {
      return lineDiff;
    }

    const columnDiff = (left.loc?.column ?? Number.MAX_SAFE_INTEGER) - (right.loc?.column ?? Number.MAX_SAFE_INTEGER);
    if (columnDiff !== 0) {
      return columnDiff;
    }

    return left.label.localeCompare(right.label);
  });
}

function buildExplanationForFile(
  graph: GraphData,
  selectedNode: GraphNode,
  nodeById: Map<string, GraphNode>,
): NodeExplanation {
  const outgoingEdges = graph.edges.filter((edge) => edge.source === selectedNode.id);

  const actionNodes = outgoingEdges
    .map((edge) => nodeById.get(edge.target))
    .filter((node): node is GraphNode => Boolean(node && node.kind === 'action'));
  const sortedActionNodes = sortActionNodesByLocation(actionNodes);

  const relationCounts = new Map<string, number>();
  for (const node of sortedActionNodes) {
    const relation = String(node.metrics?.relation ?? 'unknown');
    relationCounts.set(relation, (relationCounts.get(relation) ?? 0) + 1);
  }

  const queryNodes: GraphNode[] = [];
  for (const actionNode of sortedActionNodes) {
    for (const edge of graph.edges.filter((item) => item.source === actionNode.id)) {
      const queryNode = nodeById.get(edge.target);
      if (queryNode?.kind === 'queryKey') {
        queryNodes.push(queryNode);
      }
    }
  }
  const relatedQueryNodes = collapseQueryNodes(queryNodes);

  const relationText = [...relationCounts.entries()].map(([key, count]) => `${key}:${count}`).join(', ');

  return {
    summary: `${shortText(selectedNode.label, 80)} contains ${sortedActionNodes.length} callsites (${relationText || 'none'}) and links ${relatedQueryNodes.length} query keys.`,
    files: [
      fileRef(
        selectedNode.label,
        selectedNode.file ?? selectedNode.label,
        selectedNode.loc?.line,
        selectedNode.loc?.column,
      ),
    ],
    actions: sortedActionNodes.map((node) => actionLabel(node)),
    declarations: [],
    queryKeys: filterActionQueryLabels(relatedQueryNodes.map((node) => node.label)),
  };
}

function buildExplanationForAction(
  graph: GraphData,
  selectedNode: GraphNode,
  nodeById: Map<string, GraphNode>,
): NodeExplanation {
  const incomingEdges = graph.edges.filter((edge) => edge.target === selectedNode.id);
  const outgoingEdges = graph.edges.filter((edge) => edge.source === selectedNode.id);

  const fileNode = incomingEdges
    .map((edge) => nodeById.get(edge.source))
    .find((node): node is GraphNode => Boolean(node && node.kind === 'file'));

  const queryNodes = outgoingEdges
    .map((edge) => nodeById.get(edge.target))
    .filter((node): node is GraphNode => Boolean(node && node.kind === 'queryKey'));
  const relatedQueryNodes = collapseQueryNodes(queryNodes);

  const relation = String(selectedNode.metrics?.relation ?? 'action');
  const loc = selectedNode.loc ? `${selectedNode.loc.line}:${selectedNode.loc.column}` : '-';
  const fileLabel = fileNode?.label ?? nodeFileDisplay(selectedNode);
  const filePath = fileNode?.label ?? selectedNode.file ?? fileLabel;

  return {
    summary: `${relation} call from ${shortText(fileLabel, 72)} @ ${loc}, affecting ${relatedQueryNodes.length} query keys.`,
    files: fileLabel ? [fileRef(fileLabel, filePath)] : [],
    actions: [actionLabel(selectedNode)],
    declarations: [],
    queryKeys: filterActionQueryLabels(relatedQueryNodes.map((node) => node.label)),
  };
}

function collectDeclarationCallsitesForQuery(
  graph: GraphData,
  queryNodeId: string,
  nodeById: Map<string, GraphNode>,
): NodeCallsite[] {
  const callsites: NodeCallsite[] = [];
  const dedupe = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.target !== queryNodeId) {
      continue;
    }

    const sourceNode = nodeById.get(edge.source);
    if (!(edge.relation === 'declares' && isDeclareActionNode(sourceNode))) {
      continue;
    }

    const callsite = actionLabel(sourceNode);
    const key = `${callsite.file ?? ''}:${callsite.line ?? 0}:${callsite.column ?? 0}:${callsite.label}`;
    if (dedupe.has(key)) {
      continue;
    }

    dedupe.add(key);
    callsites.push(callsite);
  }

  return sortCallsites(callsites);
}

function buildExplanationForQuery(
  graph: GraphData,
  declarationGraph: GraphData,
  selectedNode: GraphNode,
  nodeById: Map<string, GraphNode>,
): NodeExplanation {
  const incomingEdges = graph.edges.filter((edge) => edge.target === selectedNode.id);

  const actionNodes = incomingEdges
    .map((edge) => nodeById.get(edge.source))
    .filter((node): node is GraphNode => Boolean(node && node.kind === 'action'));
  const sortedActionNodes = sortActionNodesByOperation(actionNodes);

  const filesByKey = new Map<string, NodeFileRef>();
  for (const actionNode of sortedActionNodes) {
    const parentFile = graph.edges
      .filter((edge) => edge.target === actionNode.id)
      .map((edge) => nodeById.get(edge.source))
      .find((node): node is GraphNode => Boolean(node && node.kind === 'file'));

    if (parentFile) {
      filesByKey.set(parentFile.label, fileRef(parentFile.label, parentFile.label));
      continue;
    }

    const fallbackPath = actionNode.file ?? nodeFileDisplay(actionNode);
    if (fallbackPath) {
      filesByKey.set(fallbackPath, fileRef(fallbackPath, actionNode.file ?? fallbackPath));
    }
  }

  const declarationNodeById = new Map(declarationGraph.nodes.map((node) => [node.id, node]));
  const declarationTargetId =
    typeof selectedNode.metrics?.representativeQueryNodeId === 'string'
      ? selectedNode.metrics.representativeQueryNodeId
      : selectedNode.id;
  const declarations = collectDeclarationCallsitesForQuery(declarationGraph, declarationTargetId, declarationNodeById);
  const declarationSummary =
    declarations.length > 0
      ? ` Defined in ${declarations.length} callsite${declarations.length === 1 ? '' : 's'}.`
      : '';

  return {
    summary: `${shortText(selectedNode.label, 80)} is referenced by ${sortedActionNodes.length} callsites in ${filesByKey.size} files.${declarationSummary}`,
    files: sortFileRefs([...filesByKey.values()]),
    actions: sortedActionNodes.map((node) => actionLabel(node)),
    declarations,
    queryKeys: [selectedNode.label],
  };
}

export function buildNodeExplanation(
  graph: GraphData,
  selectedNode: GraphNode | null,
  declarationGraph: GraphData = graph,
): NodeExplanation | null {
  if (!selectedNode) {
    return null;
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  if (selectedNode.kind === 'file') {
    return buildExplanationForFile(graph, selectedNode, nodeById);
  }

  if (selectedNode.kind === 'action') {
    return buildExplanationForAction(graph, selectedNode, nodeById);
  }

  return buildExplanationForQuery(graph, declarationGraph, selectedNode, nodeById);
}
