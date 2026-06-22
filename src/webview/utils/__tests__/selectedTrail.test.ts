import { describe, expect, it, vi } from 'vitest';

import { buildSelectedTrail } from '../selectedTrail';
import { createGraph, createGraphEdge, createGraphNode } from '../../../testing/fixtures';

describe('webview/utils/selectedTrail', () => {
  it('walks incoming and outgoing edges around the selected node', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({ id: 'file', kind: 'file', label: 'src/file.ts', resolution: 'static' }),
        createGraphNode({ id: 'action', kind: 'action', label: 'invalidate', resolution: 'static' }),
        createGraphNode({ id: 'query', kind: 'queryKey', label: 'todo', resolution: 'static' }),
      ],
      edges: [
        createGraphEdge({ id: 'e1', source: 'file', target: 'action', relation: 'invalidates' }),
        createGraphEdge({ id: 'e2', source: 'action', target: 'query', relation: 'invalidates' }),
      ],
    });

    expect(buildSelectedTrail(graph, 'action')).toEqual({
      highlightedNodeIds: new Set(['action', 'file', 'query']),
      highlightedEdgeIds: new Set(['e1', 'e2']),
    });
    expect(buildSelectedTrail(graph, 'missing')).toEqual({
      highlightedNodeIds: new Set(),
      highlightedEdgeIds: new Set(),
    });
    expect(buildSelectedTrail(graph, null)).toEqual({
      highlightedNodeIds: new Set(),
      highlightedEdgeIds: new Set(),
    });
    expect(
      buildSelectedTrail(
        createGraph({
          nodes: [createGraphNode({ id: 'self', kind: 'action', label: 'self', resolution: 'static' })],
          edges: [createGraphEdge({ id: 'self-edge', source: 'self', target: 'self', relation: 'invalidates' })],
        }),
        'self',
      ),
    ).toEqual({
      highlightedNodeIds: new Set(['self']),
      highlightedEdgeIds: new Set(['self-edge']),
    });
  });

  it('skips a popped stack entry when the traversal receives an empty value', () => {
    const originalPop = Array.prototype.pop;
    const popSpy = vi.spyOn(Array.prototype, 'pop').mockImplementation(function popWithEmptyValue(this: unknown[]) {
      const value = originalPop.call(this);
      if (value === 'selected') {
        return undefined as never;
      }

      return value as never;
    });

    try {
      expect(
        buildSelectedTrail(
          createGraph({
            nodes: [createGraphNode({ id: 'selected', kind: 'action', label: 'selected', resolution: 'static' })],
            edges: [],
          }),
          'selected',
        ),
      ).toEqual({
        highlightedNodeIds: new Set(['selected']),
        highlightedEdgeIds: new Set(),
      });
    } finally {
      popSpy.mockRestore();
    }
  });
});
