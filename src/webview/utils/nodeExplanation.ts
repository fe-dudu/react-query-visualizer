import {
  actionLabel,
  fileRef,
  filterActionQueryLabels,
  sortActionNodesByOperation,
  sortCallsites,
  sortFileRefs,
} from './shared';
import { isDeclareActionNode, nodeFileDisplay, shortText } from './utils';
import type { GraphData, GraphNode } from '../types/model';
import type { NodeCallsite, NodeExplanation, NodeFileRef } from '../types/viewTypes';

function buildExplanationForFile(
  graph: GraphData,
  selectedNode: GraphNode,
  nodeById: Map<string, GraphNode>,
): NodeExplanation {
  const outgoingEdges = graph.edges.filter((edge) => edge.source === selectedNode.id);

  const actionNodes = outgoingEdges
    .map((edge) => nodeById.get(edge.target))
    .filter((node): node is GraphNode => Boolean(node && node.kind === 'action'));
  const sortedActionNodes = sortActionNodesByOperation(actionNodes);

  const relationCounts = new Map<string, number>();
  for (const node of sortedActionNodes) {
    const relation = String(node.metrics?.relation ?? 'unknown');
    relationCounts.set(relation, (relationCounts.get(relation) ?? 0) + 1);
  }

  const queryKeys = new Set<string>();
  for (const actionNode of sortedActionNodes) {
    for (const edge of graph.edges.filter((item) => item.source === actionNode.id)) {
      const queryNode = nodeById.get(edge.target);
      if (queryNode?.kind === 'queryKey') {
        queryKeys.add(queryNode.label);
      }
    }
  }

  const relationText = [...relationCounts.entries()].map(([key, count]) => `${key}:${count}`).join(', ');

  return {
    summary: `${shortText(selectedNode.label, 80)} contains ${sortedActionNodes.length} callsites (${relationText || 'none'}) and links ${queryKeys.size} query keys.`,
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
    queryKeys: [...queryKeys].sort((a, b) => a.localeCompare(b)),
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

  const relation = String(selectedNode.metrics?.relation ?? 'action');
  const loc = selectedNode.loc ? `${selectedNode.loc.line}:${selectedNode.loc.column}` : '-';
  const fileLabel = fileNode?.label ?? nodeFileDisplay(selectedNode);
  const filePath = fileNode?.label ?? selectedNode.file ?? fileLabel;

  return {
    summary: `${relation} call from ${shortText(fileLabel, 72)} @ ${loc}, affecting ${queryNodes.length} query keys.`,
    files: fileLabel ? [fileRef(fileLabel, filePath)] : [],
    actions: [actionLabel(selectedNode)],
    declarations: [],
    queryKeys: filterActionQueryLabels(queryNodes.map((node) => node.label)),
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
