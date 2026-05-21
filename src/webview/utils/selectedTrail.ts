import type { WebviewPayload } from '../types/model';

export interface HighlightState {
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
  selectedNodeId: string | null;
}

export function buildSelectedTrail(
  graph: WebviewPayload['graph'],
  selectedNodeId: string | null,
): {
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
} {
  const highlightedNodeIds = new Set<string>();
  const highlightedEdgeIds = new Set<string>();
  if (!selectedNodeId) {
    return { highlightedNodeIds, highlightedEdgeIds };
  }

  const hasSelectedNode = graph.nodes.some((node) => node.id === selectedNodeId);
  if (!hasSelectedNode) {
    return { highlightedNodeIds, highlightedEdgeIds };
  }

  const incoming = new Map<string, WebviewPayload['graph']['edges']>();
  const outgoing = new Map<string, WebviewPayload['graph']['edges']>();
  for (const edge of graph.edges) {
    const incomingList = incoming.get(edge.target) ?? [];
    incomingList.push(edge);
    incoming.set(edge.target, incomingList);

    const outgoingList = outgoing.get(edge.source) ?? [];
    outgoingList.push(edge);
    outgoing.set(edge.source, outgoingList);
  }

  highlightedNodeIds.add(selectedNodeId);

  const walk = (direction: 'up' | 'down') => {
    const stack = [selectedNodeId];
    const visited = new Set<string>([selectedNodeId]);

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      const edges = direction === 'up' ? (incoming.get(current) ?? []) : (outgoing.get(current) ?? []);
      for (const edge of edges) {
        highlightedEdgeIds.add(edge.id);
        const nextId = direction === 'up' ? edge.source : edge.target;
        highlightedNodeIds.add(nextId);
        if (visited.has(nextId)) {
          continue;
        }

        visited.add(nextId);
        stack.push(nextId);
      }
    }
  };

  walk('up');
  walk('down');

  return { highlightedNodeIds, highlightedEdgeIds };
}
