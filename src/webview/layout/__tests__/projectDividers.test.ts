import { describe, expect, it } from 'vitest';

import { applyProjectBandSpacing, buildProjectDividerNodes } from '../projectDividers';
import type { GraphNode } from '../../../shared/contracts';
import { createGraph, createGraphNode } from '../../../testing/fixtures';

describe('webview/layout/projectDividers', () => {
  const graph = createGraph({
    nodes: [
      createGraphNode({
        id: 'file-a',
        kind: 'file',
        label: 'apps/web/src/a.ts',
        resolution: 'static',
        metrics: { projectScope: 'web:apps/web' },
      }),
      createGraphNode({
        id: 'file-b',
        kind: 'file',
        label: 'packages/core/src/b.ts',
        resolution: 'static',
        metrics: { projectScope: 'api:packages/core' },
      }),
    ],
    edges: [],
  });

  const layoutNodes = graph.nodes.map((node, index) => ({
    id: node.id,
    type: 'rqvNode',
    data: { node, title: node.label, subtitle: node.kind, dim: false, highlighted: false, selected: false },
    position: { x: index * 20, y: index * 300 },
    width: 340,
    height: 173,
  }));

  it('applies spacing and builds line dividers', () => {
    expect(applyProjectBandSpacing(layoutNodes, graph, false)).toEqual(layoutNodes);

    const spaced = applyProjectBandSpacing(layoutNodes, graph, true);
    expect(spaced[0]?.position.y).not.toBe(layoutNodes[0]?.position.y);
    expect(spaced[1]?.position.y).toBeGreaterThan(spaced[0]?.position.y);

    const lineDividers = buildProjectDividerNodes(layoutNodes, graph, true, false);
    expect(lineDividers).toHaveLength(2);
    expect(lineDividers[0]?.data).toMatchObject({ variant: 'line', showLabel: true });
    expect(lineDividers[0]?.style).toMatchObject({ pointerEvents: 'none' });
  });

  it('builds bubble dividers and hides the first divider when requested', () => {
    const bubbleDividers = buildProjectDividerNodes(layoutNodes, graph, false, true);
    expect(bubbleDividers).toHaveLength(1);
    expect(bubbleDividers[0]?.data).toMatchObject({ variant: 'bubble', showLabel: true });
    expect(bubbleDividers[0]?.style).toMatchObject({ pointerEvents: 'none' });
  });

  it('skips dividers when a project stands alone or gaps are too tight', () => {
    const singleGraph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-a',
          kind: 'file',
          label: 'apps/web/src/a.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
      ],
      edges: [],
    });
    const singleLayout = singleGraph.nodes.map((node) => ({
      id: node.id,
      type: 'rqvNode',
      data: { node, title: node.label, subtitle: node.kind, dim: false, highlighted: false, selected: false },
      position: { x: 0, y: 0 },
      width: 340,
      height: 173,
    }));

    expect(applyProjectBandSpacing(singleLayout, singleGraph, false)).toEqual(singleLayout);
    expect(buildProjectDividerNodes(singleLayout, singleGraph, false, false)).toEqual([]);

    const tightGraph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-a',
          kind: 'file',
          label: 'apps/web/src/a.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'file-b',
          kind: 'file',
          label: 'packages/core/src/b.ts',
          resolution: 'static',
          metrics: { projectScope: 'api:packages/core' },
        }),
      ],
      edges: [],
    });
    const tightLayout = tightGraph.nodes.map((node, index) => ({
      id: node.id,
      type: 'rqvNode',
      data: { node, title: node.label, subtitle: node.kind, dim: false, highlighted: false, selected: false },
      position: { x: index * 20, y: index * 180 },
      width: 340,
      height: 173,
    }));

    const tightDividers = buildProjectDividerNodes(tightLayout, tightGraph, true, false);
    expect(tightDividers).toHaveLength(1);
    expect(tightDividers[0]?.data).toMatchObject({ variant: 'line' });
  });

  it('ignores declare actions and unknown nodes while building ranges', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'apps/web/src/a.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'declare',
          kind: 'action',
          label: 'useTodo',
          resolution: 'static',
          metrics: { relation: 'declares', declaresDirectly: 1, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'no-project',
          kind: 'queryKey',
          label: 'todo',
          resolution: 'static',
          metrics: {},
        }),
        {
          id: 'unsupported',
          kind: 'other',
          label: 'unsupported',
          resolution: 'static',
        } as unknown as GraphNode,
      ],
      edges: [],
    });
    const layout = [
      ...graph.nodes.map((node) => ({
        id: node.id,
        type: 'rqvNode',
        data: { node, title: node.label, subtitle: node.kind, dim: false, highlighted: false, selected: false },
        position: { x: 0, y: 0 },
        width: 340,
        height: 173,
      })),
      {
        id: 'missing',
        type: 'rqvNode',
        data: {},
        position: { x: 10, y: 10 },
        width: 340,
        height: 173,
      },
    ];

    const spaced = applyProjectBandSpacing(layout, graph, true);
    expect(spaced.find((node) => node.id === 'missing')).toBe(layout.find((node) => node.id === 'missing'));
    expect(spaced.find((node) => node.id === 'no-project')).toBe(layout.find((node) => node.id === 'no-project'));
    expect(buildProjectDividerNodes(layout, graph, true, true)).toHaveLength(1);
  });

  it('keeps nodes unchanged when spacing has no ranges to shift', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'declare',
          kind: 'action',
          label: 'useTodo',
          resolution: 'static',
          metrics: { relation: 'declares', projectScope: 'web:apps/web' },
        }),
      ],
      edges: [],
    });
    const layout = [
      {
        id: 'missing',
        type: 'rqvNode',
        data: {},
        position: { x: 10, y: 10 },
        width: 340,
        height: 173,
      },
    ];

    expect(applyProjectBandSpacing(layout, graph, true)).toEqual(layout);
    expect(buildProjectDividerNodes(layout, graph, true, false)).toEqual([]);
  });

  it('extends an existing project range when multiple nodes share the same project', () => {
    // Two nodes in the same project — exercises the `existing` branch that updates minX/maxX/minY/maxY.
    const sameProjectGraph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-a1',
          kind: 'file',
          label: 'apps/web/src/a1.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'file-a2',
          kind: 'file',
          label: 'apps/web/src/a2.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'file-b',
          kind: 'file',
          label: 'packages/core/src/b.ts',
          resolution: 'static',
          metrics: { projectScope: 'api:packages/core' },
        }),
      ],
      edges: [],
    });
    const sameProjectLayout = sameProjectGraph.nodes.map((node, index) => ({
      id: node.id,
      type: 'rqvNode',
      data: { node, title: node.label, subtitle: node.kind, dim: false, highlighted: false, selected: false },
      position: { x: index * 50, y: index * 250 },
      width: 340,
      height: 173,
    }));

    // Both file-a1 and file-a2 are in project 'web:apps/web'.
    // The second node updates the existing range's minX/maxX/minY/maxY.
    const spaced = applyProjectBandSpacing(sameProjectLayout, sameProjectGraph, true);
    expect(spaced).not.toEqual(sameProjectLayout);

    const dividers = buildProjectDividerNodes(sameProjectLayout, sameProjectGraph, true, false);
    // Two projects → two dividers.
    expect(dividers).toHaveLength(2);
    expect(dividers[0]?.data).toMatchObject({ variant: 'line' });
  });

  it('returns empty dividers when all node positions are non-finite in line mode', () => {
    // Forces the !Number.isFinite(minX) || !Number.isFinite(maxX) guard in buildProjectDividerNodes.
    // We need at least two nodes (different projects) so projectRanges.size >= 2,
    // but all positions are NaN so the x-span calculation produces NaN.
    const nanGraph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-a',
          kind: 'file',
          label: 'apps/web/src/a.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'file-b',
          kind: 'file',
          label: 'packages/core/src/b.ts',
          resolution: 'static',
          metrics: { projectScope: 'api:packages/core' },
        }),
      ],
      edges: [],
    });
    const nanLayout = nanGraph.nodes.map((node) => ({
      id: node.id,
      type: 'rqvNode',
      data: { node, title: node.label, subtitle: node.kind, dim: false, highlighted: false, selected: false },
      // NaN positions — Math.min(Infinity, NaN) = NaN → !Number.isFinite(NaN) = true
      position: { x: Number.NaN, y: 0 },
      width: 340,
      height: 173,
    }));

    expect(buildProjectDividerNodes(nanLayout, nanGraph, true, false)).toEqual([]);
  });

  it('handles zero shifts, hidden labels, and hidden first line dividers', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-a',
          kind: 'file',
          label: 'apps/web/src/a.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'file-b',
          kind: 'file',
          label: 'packages/core/src/b.ts',
          resolution: 'static',
          metrics: { projectScope: 'api:packages/core' },
        }),
      ],
      edges: [],
    });
    const tightButVisibleLayout = graph.nodes.map((node, index) => ({
      id: node.id,
      type: 'rqvNode',
      data: { node, title: node.label, subtitle: node.kind, dim: false, highlighted: false, selected: false },
      position: { x: 0, y: index === 0 ? 42 : 232 },
      width: 340,
      height: 173,
    }));

    const firstLayout = tightButVisibleLayout[0];
    const firstNode = graph.nodes[0];
    if (!firstLayout || !firstNode) {
      throw new Error('Missing project divider fixture');
    }
    const spaced = applyProjectBandSpacing([firstLayout], createGraph({ nodes: [firstNode], edges: [] }), true);
    expect(spaced[0]).toBe(tightButVisibleLayout[0]);

    const hiddenLabelDividers = buildProjectDividerNodes(tightButVisibleLayout, graph, true, false);
    expect(hiddenLabelDividers[1]?.data).toMatchObject({ showLabel: false });

    const withoutFirstDivider = buildProjectDividerNodes(tightButVisibleLayout, graph, false, false);
    expect(withoutFirstDivider).toHaveLength(1);
    expect(withoutFirstDivider[0]?.data).toMatchObject({ label: 'api/packages/core' });
  });
});
