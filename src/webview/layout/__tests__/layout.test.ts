import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import { getLayoutedElements } from '../layout';

describe('webview/layout/layout', () => {
  it('uses dagre for small graphs', () => {
    const nodes: Node[] = [
      {
        id: 'file',
        type: 'rqvNode',
        data: {
          node: { kind: 'file', metrics: { projectScope: 'web:apps/web' } },
          title: 'A very long file title that wraps across lines to raise the estimated height',
          subtitle: 'first line\nsecond line',
          dim: false,
          highlighted: false,
          selected: false,
        },
        position: { x: 0, y: 0 },
      },
      {
        id: 'query',
        type: 'rqvNode',
        data: {
          node: { kind: 'queryKey', metrics: { projectScope: 'web:apps/web' } },
          title: 'todo',
          subtitle: 'query',
          dim: false,
          highlighted: false,
          selected: false,
        },
        position: { x: 0, y: 0 },
      },
      {
        id: 'unknown',
        type: 'rqvNode',
        data: {},
        position: { x: 0, y: 0 },
      },
    ];
    const edges: Edge[] = [{ id: 'e1', source: 'file', target: 'query' } as Edge];

    const result = getLayoutedElements(nodes, edges, {
      direction: 'LR',
      verticalSpacing: 20,
      horizontalSpacing: 400,
    });

    expect(result.edges).toBe(edges);
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0]?.width).toBe(340);
    expect(result.nodes[0]?.height).toBeGreaterThan(173);
    expect(result.nodes[0]?.sourcePosition).toBe('right');
    expect(result.nodes[0]?.targetPosition).toBe('left');
    expect(Number.isFinite(result.nodes[0]?.position.x)).toBe(true);
    expect(Number.isFinite(result.nodes[0]?.position.y)).toBe(true);
  });

  it('switches to dense layout when edge count is high', () => {
    const nodes: Node[] = [
      {
        id: 'file',
        type: 'rqvNode',
        data: {
          node: { kind: 'file', metrics: { projectScope: 'web:apps/web' } },
          title: 'file',
          subtitle: 'file',
          dim: false,
          highlighted: false,
          selected: false,
        },
        position: { x: 0, y: 0 },
      },
      {
        id: 'query',
        type: 'rqvNode',
        data: {
          node: { kind: 'queryKey', metrics: { projectScope: 'api:packages/core' } },
          title: 'query',
          subtitle: 'query',
          dim: false,
          highlighted: false,
          selected: false,
        },
        position: { x: 0, y: 0 },
      },
      {
        id: 'unknown',
        type: 'rqvNode',
        data: {
          node: { kind: 'unknown', metrics: {} },
          title: '',
          subtitle: '',
          dim: false,
          highlighted: false,
          selected: false,
        },
        position: { x: 0, y: 0 },
      },
    ];
    const edges: Edge[] = Array.from({ length: 3001 }, (_, index) => ({
      id: `edge-${index}`,
      source: 'file',
      target: 'query',
    })) as Edge[];

    const result = getLayoutedElements(nodes, edges, {
      direction: 'LR',
      verticalSpacing: 24,
      horizontalSpacing: 500,
    });

    expect(result.nodes[0]?.position.x).toBe(0);
    expect(result.nodes[1]?.position.x).toBe(1280);
    expect(result.nodes[1]?.position.y).toBeGreaterThan(result.nodes[0]?.position.y);
    expect(result.nodes[2]?.position.x).toBe(640);
    expect(result.nodes[0]?.sourcePosition).toBe('right');
    expect(result.nodes[1]?.targetPosition).toBe('left');
  });
});
