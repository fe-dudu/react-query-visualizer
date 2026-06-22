import { describe, expect, it } from 'vitest';

import {
  compareActionOrder,
  fileImpactForNode,
  orderWeightForNode,
  projectKeyForNode,
  queryImpactForNode,
} from '../layoutNodeMetrics';
import { createGraphNode } from '../../../testing/fixtures';

describe('webview/layout/layoutNodeMetrics', () => {
  it('derives project keys and node weights', () => {
    const queryMap = new Map([['query-1', 'web:app']]);
    expect(projectKeyForNode(undefined, queryMap)).toBe('workspace');
    expect(
      projectKeyForNode(
        createGraphNode({
          id: 'query-1',
          kind: 'queryKey',
          label: 'todo',
          resolution: 'static',
          metrics: { projectScope: 'api:packages/core' },
        }),
        queryMap,
      ),
    ).toBe('web:app');
    expect(
      projectKeyForNode(
        createGraphNode({
          id: 'file',
          kind: 'file',
          label: 'src/file.ts',
          resolution: 'static',
          metrics: { projectScope: 'api:packages/core' },
        }),
        queryMap,
      ),
    ).toBe('api/packages/core');

    expect(orderWeightForNode(undefined)).toBe(2);
    expect(orderWeightForNode(createGraphNode({ id: 'file', kind: 'file', label: 'x', resolution: 'static' }))).toBe(0);
    expect(
      orderWeightForNode(
        createGraphNode({
          id: 'declare',
          kind: 'action',
          label: 'declare',
          resolution: 'static',
          metrics: { relation: 'declares' },
        }),
      ),
    ).toBe(3);
    expect(
      fileImpactForNode(
        createGraphNode({ id: 'file', kind: 'file', label: 'x', resolution: 'static', metrics: { affectedKeys: 4 } }),
      ),
    ).toBe(4);
    expect(
      fileImpactForNode(createGraphNode({ id: 'file-empty', kind: 'file', label: 'x', resolution: 'static' })),
    ).toBe(0);
    expect(fileImpactForNode(createGraphNode({ id: 'action', kind: 'action', label: 'x', resolution: 'static' }))).toBe(
      0,
    );
    expect(queryImpactForNode(undefined, new Map())).toBe(0);
    expect(
      queryImpactForNode(
        createGraphNode({
          id: 'query',
          kind: 'queryKey',
          label: 'x',
          resolution: 'static',
          metrics: { affectedFiles: 2 },
        }),
        new Map(),
      ),
    ).toBe(2);
    expect(
      queryImpactForNode(
        createGraphNode({
          id: 'query',
          kind: 'queryKey',
          label: 'x',
          resolution: 'static',
          metrics: { affectedFiles: 2 },
        }),
        new Map([['query', 5]]),
      ),
    ).toBe(5);
    expect(
      queryImpactForNode(
        createGraphNode({ id: 'query-empty', kind: 'queryKey', label: 'x', resolution: 'static' }),
        new Map(),
      ),
    ).toBe(0);
  });

  it('compares actions with location and fallback ordering', () => {
    expect(compareActionOrder(undefined, undefined, undefined, undefined)).toBe(0);
    expect(
      compareActionOrder(
        createGraphNode({ id: 'a', kind: 'action', label: 'a', resolution: 'static', loc: { line: 1, column: 2 } }),
        createGraphNode({ id: 'b', kind: 'action', label: 'b', resolution: 'static', loc: { line: 2, column: 1 } }),
        undefined,
        undefined,
      ),
    ).toBeLessThan(0);
    expect(
      compareActionOrder(
        createGraphNode({ id: 'a', kind: 'action', label: 'a', resolution: 'static', loc: { line: 1, column: 2 } }),
        createGraphNode({ id: 'b', kind: 'action', label: 'b', resolution: 'static', loc: { line: 1, column: 2 } }),
        { id: 'fallback-a', position: { x: 0, y: 2 }, type: 'rqvNode', data: {}, measured: undefined },
        { id: 'fallback-b', position: { x: 0, y: 4 }, type: 'rqvNode', data: {}, measured: undefined },
      ),
    ).toBeLessThan(0);
    expect(
      compareActionOrder(
        createGraphNode({ id: 'a', kind: 'action', label: 'a', resolution: 'static', loc: { line: 1, column: 1 } }),
        createGraphNode({ id: 'b', kind: 'action', label: 'b', resolution: 'static', loc: { line: 1, column: 2 } }),
        undefined,
        undefined,
      ),
    ).toBeLessThan(0);
  });
});
