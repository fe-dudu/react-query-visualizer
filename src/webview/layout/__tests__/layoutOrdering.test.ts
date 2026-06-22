import type { Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import { orderNodesForLayout } from '../layoutOrdering';
import { createGraph, createGraphEdge, createGraphNode } from '../../../testing/fixtures';

describe('webview/layout/layoutOrdering', () => {
  it('orders nodes by project, kind, impact, and label', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-a',
          kind: 'file',
          label: 'src/file-a.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web', affectedKeys: 5 },
        }),
        createGraphNode({
          id: 'file-b',
          kind: 'file',
          label: 'src/file-b.ts',
          resolution: 'static',
          metrics: { projectScope: 'api:packages/api', affectedKeys: 9 },
        }),
        createGraphNode({
          id: 'action-a',
          kind: 'action',
          label: 'load-a',
          resolution: 'static',
          loc: { line: 8, column: 1 },
          metrics: { relation: 'invalidates', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'action-b',
          kind: 'action',
          label: 'load-b',
          resolution: 'static',
          loc: { line: 9, column: 1 },
          metrics: { relation: 'sets', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'declare',
          kind: 'action',
          label: 'useTodos',
          resolution: 'static',
          loc: { line: 1, column: 1 },
          metrics: { relation: 'declares', declaresDirectly: 1, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-a',
          kind: 'queryKey',
          label: 'todos',
          resolution: 'static',
          metrics: { affectedFiles: 5, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-b',
          kind: 'queryKey',
          label: 'todos-archived',
          resolution: 'static',
          metrics: { affectedFiles: 1, projectScope: 'web:apps/web' },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'file-a-action-a', source: 'file-a', target: 'action-a', relation: 'invalidates' }),
        createGraphEdge({ id: 'file-a-action-b', source: 'file-a', target: 'action-b', relation: 'sets' }),
        createGraphEdge({ id: 'action-a-query-a', source: 'action-a', target: 'query-a', relation: 'invalidates' }),
        createGraphEdge({ id: 'action-a-query-a-2', source: 'action-a', target: 'query-a', relation: 'invalidates' }),
        createGraphEdge({ id: 'action-a-query-b', source: 'action-a', target: 'query-b', relation: 'invalidates' }),
        createGraphEdge({ id: 'file-a-declare', source: 'file-a', target: 'declare', relation: 'declares' }),
      ],
    });

    const queryCallsiteImpactById = new Map([
      ['query-a', 2],
      ['query-b', 1],
    ]);

    const ordered = orderNodesForLayout(
      [graph.nodes[4], graph.nodes[2], graph.nodes[5], graph.nodes[6], graph.nodes[0], graph.nodes[1], graph.nodes[3]]
        .filter((node): node is (typeof graph.nodes)[number] => Boolean(node))
        .map(
          (node) =>
            ({
              id: node.id,
              position: { x: 0, y: 0 },
              data: {},
            }) satisfies Node,
        ),
      graph,
      queryCallsiteImpactById,
    );

    expect(ordered.map((node) => node.id)).toEqual([
      'file-b',
      'file-a',
      'action-a',
      'action-b',
      'query-a',
      'query-b',
      'declare',
    ]);
  });

  it('uses label ordering as the final fallback within a shared project and kind', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-source',
          kind: 'file',
          label: 'src/source.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web', affectedKeys: 2 },
        }),
        createGraphNode({
          id: 'file-a',
          kind: 'file',
          label: 'src/a.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web', affectedKeys: 2 },
        }),
        createGraphNode({
          id: 'file-b',
          kind: 'file',
          label: 'src/b.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web', affectedKeys: 2 },
        }),
        createGraphNode({
          id: 'action-z',
          kind: 'action',
          label: 'z-action',
          resolution: 'static',
          loc: { line: 8, column: 1 },
          metrics: { relation: 'invalidates', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'action-a',
          kind: 'action',
          label: 'a-action',
          resolution: 'static',
          loc: { line: 9, column: 1 },
          metrics: { relation: 'invalidates', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-z',
          kind: 'queryKey',
          label: 'z-query',
          resolution: 'static',
          metrics: { affectedFiles: 1, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-a',
          kind: 'queryKey',
          label: 'a-query',
          resolution: 'static',
          metrics: { affectedFiles: 1, projectScope: 'web:apps/web' },
        }),
      ],
      edges: [
        createGraphEdge({
          id: 'file-source-action-z',
          source: 'file-source',
          target: 'action-z',
          relation: 'invalidates',
        }),
        createGraphEdge({
          id: 'file-source-action-a',
          source: 'file-source',
          target: 'action-a',
          relation: 'invalidates',
        }),
        createGraphEdge({ id: 'action-z-query-z', source: 'action-z', target: 'query-z', relation: 'invalidates' }),
        createGraphEdge({ id: 'action-a-query-a', source: 'action-a', target: 'query-a', relation: 'invalidates' }),
      ],
    });

    const ordered = orderNodesForLayout(
      graph.nodes.map((node) => ({
        id: node.id,
        type: 'rqvNode',
        data: {},
        position: { x: 0, y: 0 },
      })),
      graph,
      new Map([
        ['query-z', 1],
        ['query-a', 1],
      ]),
    );

    expect(ordered.map((node) => node.id)).toEqual([
      'file-a',
      'file-b',
      'file-source',
      'action-a',
      'action-z',
      'query-a',
      'query-z',
    ]);
  });

  it('orders same-project files and actions by impact before falling back to node ids', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-low',
          kind: 'file',
          label: 'src/low.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web', affectedKeys: 1 },
        }),
        createGraphNode({
          id: 'file-high',
          kind: 'file',
          label: 'src/high.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web', affectedKeys: 9 },
        }),
        createGraphNode({
          id: 'action-low',
          kind: 'action',
          label: 'low',
          resolution: 'static',
          metrics: { relation: 'invalidates', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'action-high',
          kind: 'action',
          label: 'high',
          resolution: 'static',
          metrics: { relation: 'invalidates', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'action-orphan-b',
          kind: 'action',
          label: 'orphan-b',
          resolution: 'static',
          metrics: { relation: 'invalidates', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'action-orphan-a',
          kind: 'action',
          label: 'orphan-a',
          resolution: 'static',
          metrics: { relation: 'invalidates', projectScope: 'web:apps/web' },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'low-edge', source: 'file-low', target: 'action-low', relation: 'invalidates' }),
        createGraphEdge({ id: 'high-edge', source: 'file-high', target: 'action-high', relation: 'invalidates' }),
      ],
    });

    const ordered = orderNodesForLayout(
      [
        { id: 'unknown-b', type: 'rqvNode', data: {}, position: { x: 0, y: 0 } },
        { id: 'unknown-a', type: 'rqvNode', data: {}, position: { x: 0, y: 0 } },
        ...graph.nodes.map((node) => ({ id: node.id, type: 'rqvNode', data: {}, position: { x: 0, y: 0 } })),
      ],
      graph,
      new Map(),
    );

    expect(ordered.map((node) => node.id)).toEqual([
      'file-high',
      'file-low',
      'action-high',
      'action-low',
      'action-orphan-a',
      'action-orphan-b',
      'unknown-a',
      'unknown-b',
    ]);
  });
});
