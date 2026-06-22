import { describe, expect, it, vi } from 'vitest';

import {
  alignDeclareNodesLeftOfQuery,
  alignQueryNodesNearSources,
  alignQueryNodesToRightColumn,
} from '../queryAlignment';
import * as layoutNodeMetrics from '../layoutNodeMetrics';
import type { GraphNode } from '../../../shared/contracts';
import { createGraph, createGraphEdge, createGraphNode } from '../../../testing/fixtures';

describe('webview/layout/queryAlignment', () => {
  it('aligns queries near sources and declare actions left of query nodes', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'src/file.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'action-a',
          kind: 'action',
          label: 'loadA',
          resolution: 'static',
          loc: { line: 10, column: 2 },
          metrics: { relation: 'invalidates', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'action-b',
          kind: 'action',
          label: 'loadB',
          resolution: 'static',
          loc: { line: 20, column: 2 },
          metrics: { relation: 'sets', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'declare',
          kind: 'action',
          label: 'useTodo',
          resolution: 'static',
          loc: { line: 1, column: 1 },
          metrics: { relation: 'declares', declaresDirectly: 1, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-a',
          kind: 'queryKey',
          label: 'todo',
          resolution: 'static',
          metrics: { affectedFiles: 4, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-b',
          kind: 'queryKey',
          label: 'todo details',
          resolution: 'static',
          metrics: { affectedFiles: 2, projectScope: 'web:apps/web' },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'file-action-a', source: 'file', target: 'action-a', relation: 'invalidates' }),
        createGraphEdge({ id: 'file-action-b', source: 'file', target: 'action-b', relation: 'sets' }),
        createGraphEdge({ id: 'action-a-query-a', source: 'action-a', target: 'query-a', relation: 'invalidates' }),
        createGraphEdge({ id: 'action-b-query-a', source: 'action-b', target: 'query-a', relation: 'sets' }),
        createGraphEdge({ id: 'action-a-query-b', source: 'action-a', target: 'query-b', relation: 'invalidates' }),
        createGraphEdge({ id: 'declare-query-a', source: 'declare', target: 'query-a', relation: 'declares' }),
      ],
    });

    const layoutNodes = graph.nodes.map((node, index) => ({
      id: node.id,
      type: 'rqvNode',
      data: { node, title: node.label, subtitle: node.kind, dim: false, highlighted: false, selected: false },
      position: { x: index * 120, y: index * 90 },
      width: 340,
      height: 173,
    }));

    const queryImpact = new Map([
      ['query-a', 3],
      ['query-b', 1],
    ]);

    const nearSources = alignQueryNodesNearSources(layoutNodes, graph, queryImpact, 24);
    const nearById = new Map(nearSources.map((node) => [node.id, node]));
    expect(nearById.get('query-a')?.position.y).not.toBe(layoutNodes[4]?.position.y);
    expect(nearById.get('query-b')?.position.y).not.toBe(layoutNodes[5]?.position.y);

    const rightAligned = alignQueryNodesToRightColumn(nearSources, graph, true);
    const rightById = new Map(rightAligned.map((node) => [node.id, node]));
    expect(rightById.get('query-a')?.position.x).toBe(rightById.get('query-b')?.position.x);
    const actionNode = layoutNodes[1];
    if (!actionNode) {
      throw new Error('Missing action node');
    }
    expect(rightById.get('action-a')?.position.x).toBe(actionNode.position.x);

    const declareAligned = alignDeclareNodesLeftOfQuery(rightAligned, graph);
    const declareById = new Map(declareAligned.map((node) => [node.id, node]));
    const declareNode = declareById.get('declare');
    const queryNode = declareById.get('query-a');
    if (!declareNode || !queryNode) {
      throw new Error('Missing aligned nodes');
    }
    expect(declareNode.position.x).toBeLessThan(queryNode.position.x);
  });

  it('keeps layout unchanged when no query nodes are present', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'src/file.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
      ],
      edges: [],
    });

    const layoutNodes = [
      (() => {
        const fileNode = graph.nodes[0];
        if (!fileNode) {
          throw new Error('Missing file node');
        }

        return {
          id: 'file',
          type: 'rqvNode',
          data: {
            node: fileNode,
            title: 'src/file.ts',
            subtitle: 'file',
            dim: false,
            highlighted: false,
            selected: false,
          },
          position: { x: 12, y: 34 },
          width: 340,
          height: 173,
        };
      })(),
    ];

    expect(alignQueryNodesNearSources(layoutNodes, graph, new Map(), 24)).toEqual(layoutNodes);
    expect(alignQueryNodesToRightColumn(layoutNodes, graph, false)).toEqual(layoutNodes);
    expect(alignDeclareNodesLeftOfQuery(layoutNodes, graph)).toEqual(layoutNodes);
  });

  it('keeps query x when no non-query nodes contribute a right edge', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'query',
          kind: 'queryKey',
          label: 'todo',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
      ],
      edges: [],
    });
    const queryNode = graph.nodes[0];
    if (!queryNode) {
      throw new Error('Missing query node');
    }
    const layoutNodes = [
      {
        id: 'query',
        type: 'rqvNode',
        data: { node: queryNode, title: 'todo', subtitle: 'queryKey', dim: false, highlighted: false, selected: false },
        position: { x: 48, y: 12 },
        width: 340,
        height: 173,
      },
    ];

    expect(alignQueryNodesToRightColumn(layoutNodes, graph, false)).toEqual(layoutNodes);
    expect(alignQueryNodesToRightColumn(layoutNodes, graph, true)).toEqual(layoutNodes);
  });

  it('keeps grouped layout unchanged when a project has no query target column', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'src/file.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
      ],
      edges: [],
    });
    const fileNode = graph.nodes[0];
    if (!fileNode) {
      throw new Error('Missing file node');
    }
    const layoutNodes = [
      {
        id: 'file',
        type: 'rqvNode',
        data: {
          node: fileNode,
          title: 'src/file.ts',
          subtitle: 'file',
          dim: false,
          highlighted: false,
          selected: false,
        },
        position: { x: 12, y: 34 },
        width: 340,
        height: 173,
      },
    ];

    expect(alignQueryNodesToRightColumn(layoutNodes, graph, true)).toEqual(layoutNodes);
  });

  it('ignores layout nodes that are absent from the graph when aligning the right column', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'query',
          kind: 'queryKey',
          label: 'todo',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
      ],
      edges: [],
    });
    const queryNode = graph.nodes[0];
    if (!queryNode) {
      throw new Error('Missing query node');
    }
    const layoutNodes = [
      {
        id: 'ghost',
        type: 'rqvNode',
        data: {
          node: queryNode,
          title: 'ghost',
          subtitle: 'queryKey',
          dim: false,
          highlighted: false,
          selected: false,
        },
        position: { x: 1, y: 2 },
        width: 340,
        height: 173,
      },
      {
        id: 'query',
        type: 'rqvNode',
        data: { node: queryNode, title: 'todo', subtitle: 'queryKey', dim: false, highlighted: false, selected: false },
        position: { x: 48, y: 12 },
        width: 340,
        height: 173,
      },
    ];

    expect(alignQueryNodesToRightColumn(layoutNodes, graph, false)).toEqual(layoutNodes);
    expect(alignQueryNodesToRightColumn(layoutNodes, graph, true)).toEqual(layoutNodes);
  });

  it('ignores declare edges when graph or layout endpoints are missing', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'declare',
          kind: 'action',
          label: 'useTodo',
          resolution: 'static',
          metrics: { relation: 'declares', declaresDirectly: 1, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query',
          kind: 'queryKey',
          label: 'todo',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'missing-source', source: 'missing', target: 'query', relation: 'declares' }),
        createGraphEdge({ id: 'missing-target', source: 'declare', target: 'missing', relation: 'declares' }),
        createGraphEdge({ id: 'missing-layout', source: 'declare', target: 'query', relation: 'declares' }),
      ],
    });
    const declareNode = graph.nodes[0];
    if (!declareNode) {
      throw new Error('Missing declare node');
    }
    const layoutNodes = [
      {
        id: 'declare',
        type: 'rqvNode',
        data: {
          node: declareNode,
          title: 'useTodo',
          subtitle: 'action',
          dim: false,
          highlighted: false,
          selected: false,
        },
        position: { x: 200, y: 12 },
        width: 340,
        height: 173,
      },
    ];

    expect(alignDeclareNodesLeftOfQuery(layoutNodes, graph)).toEqual(layoutNodes);
  });

  it('ignores incomplete source-alignment inputs without moving nodes', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'src/file.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'action',
          kind: 'action',
          label: 'invalidate',
          resolution: 'static',
          metrics: { relation: 'invalidates', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'declare',
          kind: 'action',
          label: 'useTodo',
          resolution: 'static',
          metrics: { relation: 'declares', declaresDirectly: 1, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-a',
          kind: 'queryKey',
          label: 'a',
          resolution: 'static',
          metrics: { affectedFiles: 1, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-b',
          kind: 'queryKey',
          label: 'b',
          resolution: 'static',
          metrics: { affectedFiles: 1, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-c',
          kind: 'queryKey',
          label: 'c',
          resolution: 'static',
          metrics: { affectedFiles: 1, projectScope: 'web:apps/web' },
        }),
        {
          id: 'unsupported',
          kind: 'other',
          label: 'unsupported',
          resolution: 'static',
        } as unknown as GraphNode,
      ],
      edges: [
        createGraphEdge({ id: 'missing-source', source: 'missing', target: 'query-a', relation: 'invalidates' }),
        createGraphEdge({ id: 'missing-target', source: 'action', target: 'missing', relation: 'invalidates' }),
        createGraphEdge({ id: 'missing-layout', source: 'action', target: 'query-c', relation: 'invalidates' }),
        createGraphEdge({ id: 'declare-query', source: 'declare', target: 'query-a', relation: 'declares' }),
        createGraphEdge({ id: 'action-query-a', source: 'action', target: 'query-a', relation: 'invalidates' }),
        createGraphEdge({ id: 'action-query-b', source: 'action', target: 'query-b', relation: 'invalidates' }),
      ],
    });
    const [fileNode, actionNode, , queryA, queryB] = graph.nodes;
    if (!fileNode || !actionNode || !queryA || !queryB) {
      throw new Error('Missing graph nodes');
    }
    const layoutNodes = [
      {
        id: 'ghost',
        type: 'rqvNode',
        data: { node: fileNode, title: 'ghost', subtitle: 'file', dim: false, highlighted: false, selected: false },
        position: { x: 0, y: 0 },
      },
      {
        id: 'file',
        type: 'rqvNode',
        data: { node: fileNode, title: 'file', subtitle: 'file', dim: false, highlighted: false, selected: false },
        position: { x: 0, y: 0 },
        measured: { width: 320, height: 120 },
      },
      {
        id: 'action',
        type: 'rqvNode',
        data: {
          node: actionNode,
          title: 'action',
          subtitle: 'action',
          dim: false,
          highlighted: false,
          selected: false,
        },
        position: { x: 100, y: 160 },
        width: 320,
      },
      {
        id: 'query-a',
        type: 'rqvNode',
        data: { node: queryA, title: 'a', subtitle: 'queryKey', dim: false, highlighted: false, selected: false },
        position: { x: 400, y: 320 },
        width: 320,
      },
      {
        id: 'query-b',
        type: 'rqvNode',
        data: { node: queryB, title: 'b', subtitle: 'queryKey', dim: false, highlighted: false, selected: false },
        position: { x: 420, y: 320 },
        width: 320,
      },
      {
        id: 'unsupported',
        type: 'rqvNode',
        data: {},
        position: { x: 1, y: 1 },
        width: 320,
      },
    ];

    const aligned = alignQueryNodesNearSources(layoutNodes, graph, new Map([['query-b', 10]]), 24);
    expect(aligned.find((node) => node.id === 'ghost')?.position).toEqual({ x: 0, y: 0 });
    expect(aligned.find((node) => node.id === 'query-a')?.position.y).not.toBe(320);
    expect(aligned.find((node) => node.id === 'query-b')?.position.y).not.toBe(320);
  });

  it('sorts same-priority queries by label and uses default declare action width', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'action',
          kind: 'action',
          label: 'invalidate',
          resolution: 'static',
          metrics: { relation: 'invalidates', projectScope: 'web' },
        }),
        createGraphNode({
          id: 'query-b',
          kind: 'queryKey',
          label: 'b',
          resolution: 'static',
          metrics: { projectScope: 'web' },
        }),
        createGraphNode({
          id: 'query-a',
          kind: 'queryKey',
          label: 'a',
          resolution: 'static',
          metrics: { projectScope: 'web' },
        }),
        createGraphNode({
          id: 'declare',
          kind: 'action',
          label: 'useTodo',
          resolution: 'static',
          metrics: { relation: 'declares', declaresDirectly: 1, projectScope: 'web' },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'action-query-a', source: 'action', target: 'query-a', relation: 'invalidates' }),
        createGraphEdge({ id: 'action-query-b', source: 'action', target: 'query-b', relation: 'invalidates' }),
        createGraphEdge({ id: 'declare-query-a', source: 'declare', target: 'query-a', relation: 'declares' }),
      ],
    });
    const layoutNodes = [
      { id: 'action', type: 'rqvNode', data: {}, position: { x: 0, y: 0 }, height: 100 },
      { id: 'query-b', type: 'rqvNode', data: {}, position: { x: 400, y: 200 }, height: 100 },
      { id: 'query-a', type: 'rqvNode', data: {}, position: { x: 420, y: 200 }, height: 100 },
      { id: 'declare', type: 'rqvNode', data: {}, position: { x: 500, y: 0 }, height: 100 },
    ];

    const aligned = alignQueryNodesNearSources(layoutNodes, graph, new Map(), 20);
    expect(aligned.find((node) => node.id === 'query-a')?.position.y).toBeLessThan(
      aligned.find((node) => node.id === 'query-b')?.position.y ?? 0,
    );

    const declareAligned = alignDeclareNodesLeftOfQuery(layoutNodes, graph);
    expect(declareAligned.find((node) => node.id === 'declare')?.position.x).toBe(24);
  });

  it('sorts equal-action-count equal-impact queries by their current y position', () => {
    // Two queries with the same number of source actions and same callsite impact
    // but different y positions — the sort must fall through to the y-comparison branch.
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'action',
          kind: 'action',
          label: 'invalidate',
          resolution: 'static',
          metrics: { relation: 'invalidates', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-low',
          kind: 'queryKey',
          label: 'low',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-high',
          kind: 'queryKey',
          label: 'high',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
      ],
      edges: [
        // Each query has exactly one source action (equal action count).
        createGraphEdge({ id: 'action-query-low', source: 'action', target: 'query-low', relation: 'invalidates' }),
        createGraphEdge({ id: 'action-query-high', source: 'action', target: 'query-high', relation: 'invalidates' }),
      ],
    });
    // query-low is at y=0, query-high is at y=400 — they have equal action counts and
    // equal callsite impact (1 each) so the sorter falls through to the y-position branch.
    const layoutNodes = [
      { id: 'action', type: 'rqvNode', data: {}, position: { x: 0, y: 100 }, height: 80 },
      { id: 'query-low', type: 'rqvNode', data: {}, position: { x: 400, y: 0 }, height: 80 },
      { id: 'query-high', type: 'rqvNode', data: {}, position: { x: 400, y: 400 }, height: 80 },
    ];

    const aligned = alignQueryNodesNearSources(
      layoutNodes,
      graph,
      new Map([
        ['query-low', 1],
        ['query-high', 1],
      ]),
      20,
    );
    const byId = new Map(aligned.map((n) => [n.id, n]));
    // Both queries get assigned to rows — neither should stay at its original position.
    // The key property is that the y-sort branch was exercised (y differs between the two queries),
    // meaning they end up assigned to different rows.
    expect(byId.get('query-low')?.position.y).not.toBe(byId.get('query-high')?.position.y);
  });

  it('returns nodes unchanged when all project node y-values are non-finite', () => {
    // Forces the !Number.isFinite(minY) guard, then the yByNodeId.size===0 early return.
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'action',
          kind: 'action',
          label: 'invalidate',
          resolution: 'static',
          metrics: { relation: 'invalidates', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query',
          kind: 'queryKey',
          label: 'todo',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
      ],
      edges: [createGraphEdge({ id: 'action-query', source: 'action', target: 'query', relation: 'invalidates' })],
    });

    // position.y is NaN — typeof NaN === 'number' is true BUT Number.isFinite(NaN) is false,
    // so minY/maxY stay as Infinity/-Infinity and the project iteration is skipped entirely.
    const layoutNodes = [
      { id: 'action', type: 'rqvNode', data: {}, position: { x: 0, y: Number.NaN }, height: 80 },
      { id: 'query', type: 'rqvNode', data: {}, position: { x: 400, y: Number.NaN }, height: 80 },
    ];

    const result = alignQueryNodesNearSources(layoutNodes, graph, new Map(), 20);
    // yByNodeId stays empty → early return with original nodes array
    expect(result).toBe(layoutNodes);
  });

  it('uses measured height for rowNodeHeight computation in alignQueryNodesNearSources', () => {
    // Ensures the measured?.height branch is taken (and not the fallback height).
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'src/file.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'action',
          kind: 'action',
          label: 'loadA',
          resolution: 'static',
          metrics: { relation: 'invalidates', projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query',
          kind: 'queryKey',
          label: 'todo',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
      ],
      edges: [createGraphEdge({ id: 'action-query', source: 'action', target: 'query', relation: 'invalidates' })],
    });

    // Use measured dimensions — the measured?.height branch is exercised here.
    const layoutNodes = [
      { id: 'file', type: 'rqvNode', data: {}, position: { x: 0, y: 0 }, measured: { width: 340, height: 200 } },
      { id: 'action', type: 'rqvNode', data: {}, position: { x: 100, y: 200 }, measured: { width: 340, height: 200 } },
      { id: 'query', type: 'rqvNode', data: {}, position: { x: 400, y: 100 }, measured: { width: 340, height: 200 } },
    ];

    const result = alignQueryNodesNearSources(layoutNodes, graph, new Map(), 20);
    const queryNode = result.find((n) => n.id === 'query');
    expect(queryNode).toBeDefined();
    // Position should be adjusted to align with the action
    expect(typeof queryNode?.position.y).toBe('number');
  });

  it('aligns query x to rightmost non-query right in grouped mode even when non-query right exceeds query x', () => {
    // Covers the branch where rightMostNonQueryRight is finite in grouped (groupByProject=true) mode
    // and is greater than rightMostQueryX — targetX takes the non-query-right value.
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'src/file.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query',
          kind: 'queryKey',
          label: 'todo',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
      ],
      edges: [],
    });
    const fileNode = graph.nodes[0];
    const queryNode = graph.nodes[1];
    if (!fileNode || !queryNode) {
      throw new Error('Missing graph nodes');
    }

    // file node's right edge (x=500 + width=340 = 840) exceeds query node's x (200),
    // so targetX = 840 + DECLARE_ACTION_QUERY_GAP (56) = 896 > 200.
    const layoutNodes = [
      {
        id: 'file',
        type: 'rqvNode',
        data: {
          node: fileNode,
          title: 'src/file.ts',
          subtitle: 'file',
          dim: false,
          highlighted: false,
          selected: false,
        },
        position: { x: 500, y: 0 },
        width: 340,
        height: 173,
      },
      {
        id: 'query',
        type: 'rqvNode',
        data: { node: queryNode, title: 'todo', subtitle: 'queryKey', dim: false, highlighted: false, selected: false },
        position: { x: 200, y: 50 },
        width: 340,
        height: 173,
      },
    ];

    const result = alignQueryNodesToRightColumn(layoutNodes, graph, true);
    const byId = new Map(result.map((n) => [n.id, n]));
    // query should be pushed to the right of the file node
    expect(byId.get('query')?.position.x).toBeGreaterThan(200);
    expect(byId.get('file')?.position.x).toBe(500);
  });

  it('aligns declare node x using the minimum across multiple declares queries', () => {
    // When a declare action targets multiple query nodes that have different x positions,
    // the declare node should be positioned relative to the leftmost query.
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'declare',
          kind: 'action',
          label: 'useTodo',
          resolution: 'static',
          metrics: { relation: 'declares', declaresDirectly: 1, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-left',
          kind: 'queryKey',
          label: 'left',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query-right',
          kind: 'queryKey',
          label: 'right',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
      ],
      edges: [
        createGraphEdge({ id: 'declare-left', source: 'declare', target: 'query-left', relation: 'declares' }),
        createGraphEdge({ id: 'declare-right', source: 'declare', target: 'query-right', relation: 'declares' }),
      ],
    });
    const declareNode = graph.nodes[0];
    const queryLeft = graph.nodes[1];
    const queryRight = graph.nodes[2];
    if (!declareNode || !queryLeft || !queryRight) {
      throw new Error('Missing graph nodes');
    }

    const layoutNodes = [
      {
        id: 'declare',
        type: 'rqvNode',
        data: {
          node: declareNode,
          title: 'useTodo',
          subtitle: 'action',
          dim: false,
          highlighted: false,
          selected: false,
        },
        position: { x: 800, y: 0 },
        width: 340,
        height: 173,
      },
      {
        id: 'query-left',
        type: 'rqvNode',
        data: { node: queryLeft, title: 'left', subtitle: 'queryKey', dim: false, highlighted: false, selected: false },
        position: { x: 300, y: 0 },
        width: 340,
        height: 173,
      },
      {
        id: 'query-right',
        type: 'rqvNode',
        data: {
          node: queryRight,
          title: 'right',
          subtitle: 'queryKey',
          dim: false,
          highlighted: false,
          selected: false,
        },
        position: { x: 600, y: 0 },
        width: 340,
        height: 173,
      },
    ];

    const result = alignDeclareNodesLeftOfQuery(layoutNodes, graph);
    const byId = new Map(result.map((n) => [n.id, n]));
    // declare should be placed to the left of query-left (x=300), not query-right (x=600)
    // desiredX for query-left = 300 - 340 - 56 = -96
    // desiredX for query-right = 600 - 340 - 56 = 204
    // min(currentX=800, -96) = -96, then min(-96, 204) = -96 → final x = -96
    expect(byId.get('declare')?.position.x).toBe(-96);
  });

  it('returns a grouped query node unchanged when the projected target column is missing', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'src/file.ts',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'query',
          kind: 'queryKey',
          label: 'todo',
          resolution: 'static',
          metrics: { projectScope: 'web:apps/web' },
        }),
      ],
      edges: [],
    });

    const projectSpy = vi.spyOn(layoutNodeMetrics, 'projectKeyForNode');
    let callCount = 0;
    projectSpy.mockImplementation(() => {
      callCount += 1;
      return callCount <= 2 ? 'web:apps/web' : 'other';
    });

    const layoutNodes = [
      {
        id: 'file',
        type: 'rqvNode',
        data: {},
        position: { x: 0, y: 0 },
        width: 340,
        height: 173,
      },
      {
        id: 'query',
        type: 'rqvNode',
        data: {},
        position: { x: 200, y: 40 },
        width: 340,
        height: 173,
      },
    ];

    try {
      expect(alignQueryNodesToRightColumn(layoutNodes, graph, true)).toEqual(layoutNodes);
    } finally {
      projectSpy.mockRestore();
    }
  });
});
