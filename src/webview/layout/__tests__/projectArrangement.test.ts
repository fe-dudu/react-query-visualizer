import { describe, expect, it, vi } from 'vitest';

import { arrangeProjectsHorizontally, isMonorepoGraph } from '../projectArrangement';
import * as projectLayout from '../projectLayout';
import { createGraph, createGraphNode } from '../../../testing/fixtures';

describe('webview/layout/projectArrangement', () => {
  it('detects monorepo-like graphs and shifts projects horizontally', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-a',
          kind: 'file',
          label: 'apps/web/src/a.ts',
          resolution: 'static',
          metrics: { projectScope: 'root:apps/web' },
        }),
        createGraphNode({
          id: 'file-b',
          kind: 'file',
          label: 'packages/core/src/b.ts',
          resolution: 'static',
          metrics: { projectScope: 'root:packages/core' },
        }),
      ],
      edges: [],
    });

    expect(isMonorepoGraph(graph)).toBe(true);
    const firstNode = graph.nodes[0];
    if (!firstNode) {
      throw new Error('Missing first node');
    }
    expect(isMonorepoGraph(createGraph({ nodes: [firstNode], edges: [] }))).toBe(false);

    const layoutNodes = graph.nodes.map((node, index) => ({
      id: node.id,
      type: 'rqvNode',
      data: { node, title: node.label, subtitle: node.kind, dim: false, highlighted: false, selected: false },
      position: { x: index * 500, y: index * 20 },
      width: 340,
      height: 173,
    }));

    const shifted = arrangeProjectsHorizontally(layoutNodes, graph, true);
    expect(shifted[1]?.position.x).not.toBe(layoutNodes[1]?.position.x);
    expect(shifted[0]?.position.x).toBe(layoutNodes[0]?.position.x);
    expect(arrangeProjectsHorizontally(layoutNodes, graph, false)).toEqual(layoutNodes);
  });

  it('leaves single-project graphs unchanged and ignores non-project nodes', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-a',
          kind: 'file',
          label: 'apps/web/src/a.ts',
          resolution: 'static',
          metrics: { projectScope: 'root:apps/web' },
        }),
        createGraphNode({
          id: 'misc',
          kind: 'action',
          label: 'misc',
          resolution: 'static',
        }),
      ],
      edges: [],
    });

    expect(isMonorepoGraph(graph)).toBe(false);

    const layoutNodes = graph.nodes.map((node) => ({
      id: node.id,
      type: 'rqvNode',
      data: { node, title: node.label, subtitle: node.kind, dim: false, highlighted: false, selected: false },
      position: { x: 10, y: 20 },
      width: 340,
      height: 173,
    }));

    const shifted = arrangeProjectsHorizontally(layoutNodes, graph, true);
    expect(shifted[0]?.position.x).toBe(layoutNodes[0]?.position.x);
    expect(shifted[1]?.position.x).not.toBe(layoutNodes[1]?.position.x);
  });

  it('treats a project scope without a slash in the project path as non-monorepo', () => {
    // Exercises the `!parsed.project.includes('/')` branch (line 29-30) in isMonorepoGraph.
    // A project scope like 'root:myweb' has project = 'myweb' (no slash) → not monorepo-like.
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-a',
          kind: 'file',
          label: 'src/a.ts',
          resolution: 'static',
          metrics: { projectScope: 'root:myweb' },
        }),
        createGraphNode({
          id: 'file-b',
          kind: 'file',
          label: 'src/b.ts',
          resolution: 'static',
          metrics: { projectScope: 'root:myapi' },
        }),
      ],
      edges: [],
    });

    // 'myweb' and 'myapi' have no slash — neither triggers the monorepo path, so result is false.
    expect(isMonorepoGraph(graph)).toBe(false);
  });

  it('extends bounds when multiple nodes belong to the same project', () => {
    // Exercises lines 93-96: bounds.minX/maxX/minY/maxY update for a second node in the same project.
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-a1',
          kind: 'file',
          label: 'apps/web/src/a1.ts',
          resolution: 'static',
          metrics: { projectScope: 'root:apps/web' },
        }),
        createGraphNode({
          id: 'file-a2',
          kind: 'file',
          label: 'apps/web/src/a2.ts',
          resolution: 'static',
          metrics: { projectScope: 'root:apps/web' },
        }),
        createGraphNode({
          id: 'file-b',
          kind: 'file',
          label: 'packages/core/src/b.ts',
          resolution: 'static',
          metrics: { projectScope: 'root:packages/core' },
        }),
      ],
      edges: [],
    });
    const layoutNodes = graph.nodes.map((node, index) => ({
      id: node.id,
      type: 'rqvNode',
      data: { node, title: node.label, subtitle: node.kind, dim: false, highlighted: false, selected: false },
      position: { x: index * 400, y: index * 100 },
      width: 340,
      height: 173,
    }));

    // Two nodes are in 'root:apps/web' so the second one updates the existing bounds entry.
    // The arrangement should still produce a valid result with shifts applied.
    const shifted = arrangeProjectsHorizontally(layoutNodes, graph, true);
    expect(shifted).toHaveLength(layoutNodes.length);
    // At least one node should be shifted.
    const anyShifted = shifted.some(
      (n, i) => n.position.x !== layoutNodes[i]?.position.x || n.position.y !== layoutNodes[i]?.position.y,
    );
    expect(anyShifted).toBe(true);
  });

  it('ignores unsupported graph nodes and layout gaps', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-a',
          kind: 'file',
          label: 'apps/web/src/a.ts',
          resolution: 'static',
          metrics: { projectScope: 'root:apps/web' },
        }),
        createGraphNode({
          id: 'file-b',
          kind: 'file',
          label: 'packages/core/src/b.ts',
          resolution: 'static',
          metrics: { projectScope: 'root:packages/core' },
        }),
        createGraphNode({
          id: 'file-missing-layout',
          kind: 'file',
          label: 'packages/extra/src/c.ts',
          resolution: 'static',
          metrics: { projectScope: 'root:packages/extra' },
        }),
        {
          ...createGraphNode({ id: 'unsupported', kind: 'file', label: 'unsupported', resolution: 'static' }),
          kind: 'observer',
        } as never,
      ],
      edges: [],
    });
    const firstNode = graph.nodes[0];
    if (!firstNode) {
      throw new Error('Missing first graph node');
    }
    const firstOnlyGraph = createGraph({ nodes: [firstNode], edges: [] });
    const layoutNodes = [
      {
        id: 'file-a',
        type: 'rqvNode',
        data: {},
        position: { x: 10, y: 20 },
        measured: { width: 200, height: 100 },
      },
      {
        id: 'layout-only',
        type: 'rqvNode',
        data: {},
        position: { x: 300, y: 400 },
        measured: { width: 200, height: 100 },
      },
      {
        id: 'file-b',
        type: 'rqvNode',
        data: {},
        position: { x: 600, y: 20 },
        measured: { width: 200, height: 100 },
      },
    ];

    const unsupported = graph.nodes.find((node) => node.id === 'unsupported');
    if (!unsupported) {
      throw new Error('Missing unsupported node');
    }
    expect(isMonorepoGraph(createGraph({ nodes: [unsupported], edges: [] }))).toBe(false);
    expect(arrangeProjectsHorizontally(layoutNodes, firstOnlyGraph, true)).toBe(layoutNodes);
    expect(arrangeProjectsHorizontally(layoutNodes, graph, true)[1]).toBe(layoutNodes[1]);
  });

  it('returns nodes unchanged when project shifts are empty after bounds are built', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-a',
          kind: 'file',
          label: 'apps/web/src/a.ts',
          resolution: 'static',
          metrics: { projectScope: 'root:apps/web' },
        }),
        createGraphNode({
          id: 'file-b',
          kind: 'file',
          label: 'packages/core/src/b.ts',
          resolution: 'static',
          metrics: { projectScope: 'root:packages/core' },
        }),
      ],
      edges: [],
    });
    const layoutNodes = [
      {
        id: 'file-a',
        type: 'rqvNode',
        data: {},
        position: { x: 10, y: 20 },
        measured: { width: 200, height: 100 },
      },
      {
        id: 'file-b',
        type: 'rqvNode',
        data: {},
        position: { x: 300, y: 20 },
        measured: { width: 200, height: 100 },
      },
    ];

    const spy = vi.spyOn(projectLayout, 'computeProjectGridShifts').mockReturnValue(new Map());
    try {
      expect(arrangeProjectsHorizontally(layoutNodes, graph, true)).toBe(layoutNodes);
    } finally {
      spy.mockRestore();
    }
  });

  it('skips graph nodes that have no rendered layout entry', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-a',
          kind: 'file',
          label: 'apps/web/src/a.ts',
          resolution: 'static',
          metrics: { projectScope: 'root:apps/web' },
        }),
        createGraphNode({
          id: 'file-b',
          kind: 'file',
          label: 'packages/core/src/b.ts',
          resolution: 'static',
          metrics: { projectScope: 'root:packages/core' },
        }),
      ],
      edges: [],
    });
    const layoutNodes = [
      {
        id: 'file-a',
        type: 'rqvNode',
        data: {},
        position: { x: 10, y: 20 },
        measured: { width: 200, height: 100 },
      },
    ];

    expect(arrangeProjectsHorizontally(layoutNodes, graph, true)).toBe(layoutNodes);
  });
});
