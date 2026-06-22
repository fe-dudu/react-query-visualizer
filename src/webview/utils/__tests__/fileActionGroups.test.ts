import { describe, expect, it, vi } from 'vitest';

import { alignFileActionGroups } from '../fileActionGroups';
import * as layoutNodeMetrics from '../../layout/layoutNodeMetrics';
import type { GraphNode } from '../../../shared/contracts';
import { createGraph, createGraphEdge, createGraphNode } from '../../../testing/fixtures';

describe('webview/utils/fileActionGroups', () => {
  it('groups file, action, and query rows by project', () => {
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
          id: 'action-a',
          kind: 'action',
          label: 'loadA',
          resolution: 'static',
          loc: { line: 20, column: 2 },
          metrics: { relation: 'invalidates', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'action-a-orphan',
          kind: 'action',
          label: 'orphanA',
          resolution: 'static',
          loc: { line: 30, column: 2 },
          metrics: { relation: 'sets', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-a',
          kind: 'queryKey',
          label: 'todo',
          resolution: 'static',
          metrics: { affectedFiles: 3, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'declare-a',
          kind: 'action',
          label: 'useTodo',
          resolution: 'static',
          loc: { line: 1, column: 1 },
          metrics: { relation: 'declares', declaresDirectly: 1, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'file-b',
          kind: 'file',
          label: 'packages/core/src/b.ts',
          resolution: 'static',
          metrics: { projectScope: 'api:packages/core' },
        }),
        createGraphNode({
          id: 'action-b',
          kind: 'action',
          label: 'loadB',
          resolution: 'static',
          loc: { line: 10, column: 1 },
          metrics: { relation: 'sets', projectScope: 'api:packages/core' },
        }),
        createGraphNode({
          id: 'query-b',
          kind: 'queryKey',
          label: 'user',
          resolution: 'static',
          metrics: { affectedFiles: 1, projectScope: 'api:packages/core' },
        }),
      ],
      edges: [
        createGraphEdge({
          id: 'file-action-missing-layout',
          source: 'file-a',
          target: 'action-a-orphan',
          relation: 'sets',
        }),
        createGraphEdge({ id: 'file-a-action-a', source: 'file-a', target: 'action-a', relation: 'invalidates' }),
        createGraphEdge({
          id: 'file-a-declare-a',
          source: 'file-a',
          target: 'declare-a',
          relation: 'declares',
        }),
        createGraphEdge({ id: 'file-b-action-b', source: 'file-b', target: 'action-b', relation: 'sets' }),
      ],
    });

    const layoutNodes = graph.nodes.map((node, index) => ({
      id: node.id,
      type: 'rqvNode',
      data: { node, title: node.label, subtitle: node.kind, dim: false, highlighted: false, selected: false },
      position: { x: 10 + index * 5, y: 10 + index * 100 },
      width: 340,
      height: 173,
    }));

    const result = alignFileActionGroups(layoutNodes, graph, 32);
    const byId = new Map(result.map((node) => [node.id, node]));

    expect(byId.get('file-a')?.position.y).toBe(byId.get('action-a')?.position.y);
    expect(byId.get('query-a')?.position.y).toBe(byId.get('file-a')?.position.y);
    expect(byId.get('action-a-orphan')?.position.y).toBeGreaterThan(byId.get('query-a')?.position.y ?? 0);
    expect(byId.get('file-b')?.position.y).toBeGreaterThan(byId.get('query-a')?.position.y ?? 0);
    expect(byId.get('action-b')?.position.y).toBe(byId.get('file-b')?.position.y);
  });

  it('leaves unrelated nodes in place and falls back to measured heights', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'src/file.ts',
          resolution: 'static',
          metrics: { affectedKeys: 2 },
        }),
        createGraphNode({
          id: 'action',
          kind: 'action',
          label: 'zAction',
          resolution: 'static',
          loc: { line: 2, column: 1 },
          metrics: { relation: 'invalidates' },
        }),
        createGraphNode({
          id: 'query-low',
          kind: 'queryKey',
          label: 'b',
          resolution: 'static',
          metrics: { affectedFiles: 1 },
        }),
        createGraphNode({
          id: 'query-high',
          kind: 'queryKey',
          label: 'a',
          resolution: 'static',
          metrics: { affectedFiles: 4 },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'missing-source', source: 'missing', target: 'action', relation: 'invalidates' }),
        createGraphEdge({ id: 'file-action', source: 'file', target: 'action', relation: 'invalidates' }),
      ],
    });
    const layoutNodes = [
      {
        id: 'file',
        type: 'rqvNode',
        data: {},
        position: { x: 0, y: 40 },
        measured: { width: 100, height: 260 },
      },
      { id: 'action', type: 'rqvNode', data: {}, position: { x: 100, y: 80 }, height: 120 },
      { id: 'query-low', type: 'rqvNode', data: {}, position: { x: 200, y: 20 } },
      { id: 'query-high', type: 'rqvNode', data: {}, position: { x: 200, y: 100 } },
      { id: 'floating', type: 'rqvNode', data: {}, position: { x: 300, y: 555 } },
    ];

    const result = alignFileActionGroups(layoutNodes, graph, 12);
    const byId = new Map(result.map((node) => [node.id, node]));

    expect(byId.get('floating')?.position.y).toBe(555);
    expect(byId.get('file')?.position.y).toBe(byId.get('action')?.position.y);
    expect(byId.get('query-high')?.position.y).toBeLessThan(byId.get('query-low')?.position.y ?? 0);
  });

  it('centers files over multiple linked actions and sorts tied rows by label', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-z',
          kind: 'file',
          label: 'z-file.ts',
          resolution: 'static',
          metrics: { affectedKeys: 1 },
        }),
        createGraphNode({
          id: 'file-a',
          kind: 'file',
          label: 'a-file.ts',
          resolution: 'static',
          metrics: { affectedKeys: 1 },
        }),
        createGraphNode({
          id: 'action-2',
          kind: 'action',
          label: 'second',
          resolution: 'static',
          loc: { line: 20, column: 1 },
          metrics: { relation: 'invalidates' },
        }),
        createGraphNode({
          id: 'action-1',
          kind: 'action',
          label: 'first',
          resolution: 'static',
          loc: { line: 10, column: 1 },
          metrics: { relation: 'invalidates' },
        }),
        createGraphNode({
          id: 'action-3',
          kind: 'action',
          label: 'third',
          resolution: 'static',
          loc: { line: 30, column: 1 },
          metrics: { relation: 'invalidates' },
        }),
        createGraphNode({
          id: 'query-b',
          kind: 'queryKey',
          label: 'b-query',
          resolution: 'static',
          metrics: { affectedFiles: 1 },
        }),
        createGraphNode({
          id: 'query-a',
          kind: 'queryKey',
          label: 'a-query',
          resolution: 'static',
          metrics: { affectedFiles: 1 },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'file-z-action-2', source: 'file-z', target: 'action-2', relation: 'invalidates' }),
        createGraphEdge({ id: 'file-z-action-1', source: 'file-z', target: 'action-1', relation: 'invalidates' }),
        createGraphEdge({ id: 'file-z-action-3', source: 'file-z', target: 'action-3', relation: 'invalidates' }),
      ],
    });
    const layoutNodes = graph.nodes.map((node) => ({
      id: node.id,
      type: 'rqvNode',
      data: {},
      position: { x: 0, y: 100 },
      height: 100,
    }));

    const result = alignFileActionGroups(layoutNodes, graph, 20);
    const byId = new Map(result.map((node) => [node.id, node]));

    expect(byId.get('action-1')?.position.y).toBeLessThan(byId.get('file-z')?.position.y ?? 0);
    expect(byId.get('file-z')?.position.y).toBeLessThan(byId.get('action-3')?.position.y ?? 0);
    expect(byId.get('file-a')?.position.y).toBeLessThan(byId.get('action-1')?.position.y ?? 0);
    expect(byId.get('query-a')?.position.y).toBeLessThan(byId.get('query-b')?.position.y ?? 0);
  });

  it('sorts files and queries by existing y positions when impacts tie', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-low',
          kind: 'file',
          label: 'low.ts',
          resolution: 'static',
          metrics: { affectedKeys: 1 },
        }),
        createGraphNode({
          id: 'file-high',
          kind: 'file',
          label: 'high.ts',
          resolution: 'static',
          metrics: { affectedKeys: 1 },
        }),
        createGraphNode({
          id: 'query-low',
          kind: 'queryKey',
          label: 'low',
          resolution: 'static',
          metrics: { affectedFiles: 1 },
        }),
        createGraphNode({
          id: 'query-high',
          kind: 'queryKey',
          label: 'high',
          resolution: 'static',
          metrics: { affectedFiles: 1 },
        }),
      ],
      edges: [],
    });
    const layoutNodes = [
      { id: 'file-low', type: 'rqvNode', data: {}, position: { x: 0, y: 400 }, height: 100 },
      { id: 'file-high', type: 'rqvNode', data: {}, position: { x: 0, y: 100 }, height: 100 },
      { id: 'query-low', type: 'rqvNode', data: {}, position: { x: 0, y: 500 }, height: 100 },
      { id: 'query-high', type: 'rqvNode', data: {}, position: { x: 0, y: 200 }, height: 100 },
    ];

    const result = alignFileActionGroups(layoutNodes, graph, 20);
    const byId = new Map(result.map((node) => [node.id, node]));

    expect(byId.get('file-high')?.position.y).toBeLessThan(byId.get('file-low')?.position.y ?? 0);
    expect(byId.get('query-high')?.position.y).toBeLessThan(byId.get('query-low')?.position.y ?? 0);
  });

  it('assigns orphan actions (no file-action edge) to rows after file-linked actions', () => {
    // An action in a project bucket that has NO incoming file-to-action edge is an orphan.
    // It should be placed after all file-linked action rows (lines 199-201).
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-x',
          kind: 'file',
          label: 'x.ts',
          resolution: 'static',
          metrics: { affectedKeys: 1 },
        }),
        createGraphNode({
          id: 'action-linked',
          kind: 'action',
          label: 'linkedAction',
          resolution: 'static',
          loc: { line: 1, column: 1 },
          metrics: { relation: 'invalidates' },
        }),
        createGraphNode({
          id: 'action-orphan',
          kind: 'action',
          label: 'orphanAction',
          resolution: 'static',
          loc: { line: 2, column: 1 },
          metrics: { relation: 'invalidates' },
        }),
        createGraphNode({
          id: 'query-x',
          kind: 'queryKey',
          label: 'xQuery',
          resolution: 'static',
          metrics: { affectedFiles: 1 },
        }),
      ],
      edges: [
        // Only action-linked is connected to file-x; action-orphan has NO file-action edge.
        createGraphEdge({
          id: 'file-x-action-linked',
          source: 'file-x',
          target: 'action-linked',
          relation: 'invalidates',
        }),
      ],
    });

    const layoutNodes = graph.nodes.map((node) => ({
      id: node.id,
      type: 'rqvNode',
      data: {},
      position: { x: 0, y: 100 },
      height: 100,
    }));

    const result = alignFileActionGroups(layoutNodes, graph, 20);
    const byId = new Map(result.map((node) => [node.id, node]));

    // action-orphan should be placed after file-x and action-linked rows.
    expect(byId.get('action-orphan')?.position.y).toBeGreaterThan(byId.get('file-x')?.position.y ?? 0);
  });

  it('returns nodes unchanged when there are no layout buckets', () => {
    const graph = createGraph({
      nodes: [createGraphNode({ id: 'declare', kind: 'action', label: 'declare', metrics: { relation: 'declares' } })],
      edges: [],
    });
    const layoutNodes = [{ id: 'floating', type: 'rqvNode', data: {}, position: { x: 10, y: 20 } }];

    expect(alignFileActionGroups(layoutNodes, graph, 16)).toEqual(layoutNodes);
  });

  it('covers sparse layout edges and remaining sort fallbacks', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-high-impact',
          kind: 'file',
          label: 'b.ts',
          resolution: 'static',
          metrics: { affectedKeys: 5, projectScope: 'same:alpha' },
        }),
        createGraphNode({
          id: 'file-low-impact',
          kind: 'file',
          label: 'a.ts',
          resolution: 'static',
          metrics: { affectedKeys: 1, projectScope: 'same:alpha' },
        }),
        createGraphNode({
          id: 'file-beta',
          kind: 'file',
          label: 'beta.ts',
          resolution: 'static',
          metrics: { affectedKeys: 1, projectScope: 'same:beta' },
        }),
        createGraphNode({
          id: 'action-with-layout',
          kind: 'action',
          label: 'actionWithLayout',
          resolution: 'static',
          metrics: { relation: 'sets', projectScope: 'same:alpha' },
        }),
        createGraphNode({
          id: 'action-without-layout',
          kind: 'action',
          label: 'actionWithoutLayout',
          resolution: 'static',
          metrics: { relation: 'sets', projectScope: 'same:alpha' },
        }),
        createGraphNode({
          id: 'query-no-impact-a',
          kind: 'queryKey',
          label: 'a',
          resolution: 'static',
          metrics: { projectScope: 'same:alpha' },
        }),
        createGraphNode({
          id: 'query-no-impact-b',
          kind: 'queryKey',
          label: 'b',
          resolution: 'static',
          metrics: { projectScope: 'same:alpha' },
        }),
        {
          id: 'unsupported',
          kind: 'other',
          label: 'unsupported',
          resolution: 'static',
          metrics: { projectScope: 'same:alpha' },
        } as unknown as GraphNode,
      ],
      edges: [
        createGraphEdge({
          id: 'missing-layout-target',
          source: 'file-high-impact',
          target: 'action-without-layout',
          relation: 'sets',
        }),
        createGraphEdge({
          id: 'with-layout-target',
          source: 'file-high-impact',
          target: 'action-with-layout',
          relation: 'sets',
        }),
      ],
    });
    const layoutNodes = graph.nodes
      .filter((node) => node.id !== 'action-without-layout')
      .map((node) => ({
        id: node.id,
        type: 'rqvNode',
        data: {},
        position: { x: 0, y: 100 },
        height: 100,
      }));

    const result = alignFileActionGroups(layoutNodes, graph, 20);
    const byId = new Map(result.map((node) => [node.id, node]));

    expect(byId.get('file-high-impact')?.position.y).toBeLessThan(byId.get('file-low-impact')?.position.y ?? 0);
    expect(byId.get('query-no-impact-a')?.position.y).toBeLessThan(byId.get('query-no-impact-b')?.position.y ?? 0);
    expect(byId.get('unsupported')?.position.y).toBe(100);
  });

  it('treats missing buckets as infinite and skips missing layout nodes', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-a',
          kind: 'file',
          label: 'a.ts',
          resolution: 'static',
          metrics: { affectedKeys: 1, projectScope: 'same:alpha' },
        }),
        createGraphNode({
          id: 'file-b',
          kind: 'file',
          label: 'b.ts',
          resolution: 'static',
          metrics: { affectedKeys: 1, projectScope: 'same:beta' },
        }),
      ],
      edges: [],
    });
    const layoutNodes = [
      {
        id: 'file-a',
        type: 'rqvNode',
        data: {},
        position: { x: 0, y: 0 },
        measured: { width: 340, height: 100 },
      },
      {
        id: 'ghost',
        type: 'rqvNode',
        data: {},
        position: { x: 0, y: 10 },
        measured: { width: 340, height: 100 },
      },
      {
        id: 'file-b',
        type: 'rqvNode',
        data: {},
        position: { x: 0, y: 20 },
        measured: { width: 340, height: 100 },
      },
    ];

    const originalGet = Map.prototype.get;
    const getSpy = vi.spyOn(Map.prototype, 'get').mockImplementation(function getWithFallback(
      this: Map<unknown, unknown>,
      key: unknown,
    ) {
      const value = originalGet.call(this, key);
      if (
        typeof key === 'string' &&
        value &&
        typeof value === 'object' &&
        'fileIds' in value &&
        (key === 'same:alpha' || key === 'same:beta')
      ) {
        return undefined;
      }

      if (typeof key === 'string' && key === 'ghost' && value && typeof value === 'object' && 'position' in value) {
        return undefined;
      }

      return value;
    });

    try {
      const result = alignFileActionGroups(layoutNodes, graph, 20);
      expect(result).toHaveLength(layoutNodes.length);
      expect(result.some((node) => node.id === 'ghost')).toBe(true);
    } finally {
      getSpy.mockRestore();
    }
  });

  it('allows project labels to be absent when the helper returns nothing', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'src/file.ts',
          resolution: 'static',
          metrics: { affectedKeys: 1 },
        }),
      ],
      edges: [],
    });
    const layoutNodes = [
      {
        id: 'file',
        type: 'rqvNode',
        data: {},
        position: { x: 0, y: 0 },
        measured: { width: 340, height: 100 },
      },
    ];

    const projectSpy = vi.spyOn(layoutNodeMetrics, 'projectKeyForNode').mockReturnValue('');
    try {
      expect(alignFileActionGroups(layoutNodes, graph, 20)).toEqual(layoutNodes);
    } finally {
      projectSpy.mockRestore();
    }
  });
});
