import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import { applyEdgeGeometryLanes, minimumNodeY } from '../edgeGeometry';

describe('webview/layout/edgeGeometry', () => {
  it('spreads lanes by relation and collision group', () => {
    const nodes: Node[] = [
      {
        id: 'source',
        type: 'rqvNode',
        data: {},
        position: { x: 0, y: 10 },
        width: 100,
        height: 100,
      },
      {
        id: 'target',
        type: 'rqvNode',
        data: {},
        position: { x: 300, y: 200 },
        width: 100,
        height: 100,
      },
      {
        id: 'alpha-source',
        type: 'rqvNode',
        data: {},
        position: { x: 0, y: 30 },
        width: 100,
        height: 100,
      },
      {
        id: 'alpha-target',
        type: 'rqvNode',
        data: {},
        position: { x: 300, y: 220 },
        width: 100,
        height: 100,
      },
      {
        id: 'divider:project',
        type: 'rqvDivider',
        data: {},
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
      },
    ];
    const edges: Edge[] = [
      { id: 'invalidates-a', source: 'source', target: 'target', data: {}, type: 'smoothstep' } as Edge,
      { id: 'invalidates-b', source: 'source', target: 'target', data: {}, type: 'smoothstep' } as Edge,
      { id: 'invalidates-e', source: 'source', target: 'target', data: {}, type: 'smoothstep' } as Edge,
      { id: 'invalidates-c', source: 'source', target: 'alpha-target', data: {}, type: 'smoothstep' } as Edge,
      { id: 'invalidates-d', source: 'alpha-source', target: 'target', data: {}, type: 'smoothstep' } as Edge,
      {
        id: 'declares',
        source: 'source',
        target: 'target',
        data: { relation: 'declares', dim: false, highlighted: false, laneOffset: 0 },
        type: 'smoothstep',
      } as Edge,
      {
        id: 'sets',
        source: 'source',
        target: 'target',
        data: { relation: 'sets', dim: false, highlighted: false, laneOffset: 0 },
        type: 'smoothstep',
      } as Edge,
      {
        id: 'removes',
        source: 'source',
        target: 'target',
        data: { relation: 'removes', dim: false, highlighted: false, laneOffset: 0 },
        type: 'smoothstep',
      } as Edge,
      {
        id: 'resets',
        source: 'source',
        target: 'target',
        data: { relation: 'resets', dim: false, highlighted: false, laneOffset: 0 },
        type: 'smoothstep',
      } as Edge,
      {
        id: 'clears',
        source: 'source',
        target: 'target',
        data: { relation: 'clears', dim: false, highlighted: false, laneOffset: 0 },
        type: 'smoothstep',
      } as Edge,
      {
        id: 'cancels',
        source: 'source',
        target: 'target',
        data: { relation: 'cancels', dim: false, highlighted: false, laneOffset: 0 },
        type: 'smoothstep',
      } as Edge,
      {
        id: 'refetches',
        source: 'source',
        target: 'target',
        data: { relation: 'refetches', dim: false, highlighted: false, laneOffset: 0 },
        type: 'smoothstep',
      } as Edge,
    ];

    const result = applyEdgeGeometryLanes(nodes, edges);
    const byId = new Map(result.map((edge) => [edge.id, edge]));

    expect(byId.get('invalidates-a')?.data?.laneOffset).not.toBe(byId.get('invalidates-b')?.data?.laneOffset);
    expect(byId.get('declares')?.data?.laneOffset).toBeLessThan(0);
    expect(byId.get('sets')?.data?.laneOffset).toBeGreaterThan(0);
    expect(byId.get('removes')?.data?.laneOffset).toBeGreaterThan(0);
    expect(byId.get('resets')?.data?.laneOffset).toBeGreaterThan(0);
    expect(byId.get('clears')?.data?.laneOffset).toBeGreaterThan(0);
    expect(byId.get('cancels')?.data?.laneOffset).toBeLessThan(0);
    expect(byId.get('refetches')?.data?.laneOffset).toBeLessThan(0);
    expect(minimumNodeY(nodes)).toBe(10);
    const dividerNode = nodes[4];
    if (!dividerNode) {
      throw new Error('Missing divider node');
    }
    expect(minimumNodeY([dividerNode])).toBeNull();
    expect(minimumNodeY([])).toBeNull();
  });

  it('keeps single edges stable and uses measured node dimensions', () => {
    const nodes: Node[] = [
      {
        id: 'source',
        type: 'rqvNode',
        data: {},
        position: { x: 10, y: 20 },
        measured: { width: 50, height: 60 },
      },
      {
        id: 'target',
        type: 'rqvNode',
        data: {},
        position: { x: 200, y: 300 },
        measured: { width: 80, height: 90 },
      },
    ];
    const edges: Edge[] = [
      {
        id: 'custom',
        source: 'source',
        target: 'target',
        data: { relation: 'custom', dim: true, highlighted: true, laneOffset: 7 },
        type: 'smoothstep',
      } as Edge,
    ];

    const result = applyEdgeGeometryLanes(nodes, edges);
    expect(result).toHaveLength(1);
    expect(result[0]?.data?.laneOffset).toBe(0);
    expect(minimumNodeY(nodes)).toBe(20);
  });

  it('uses fallback geometry and stable collision ordering for sparse edges', () => {
    const nodes: Node[] = [
      {
        id: 's-a',
        type: 'rqvNode',
        data: {},
        position: { x: 0, y: 0 },
      },
      {
        id: 's-b',
        type: 'rqvNode',
        data: {},
        position: { x: 20, y: 0 },
      },
      {
        id: 't-a',
        type: 'rqvNode',
        data: {},
        position: { x: 360, y: 0 },
      },
      {
        id: 't-b',
        type: 'rqvNode',
        data: {},
        position: { x: 380, y: 0 },
      },
    ];
    const edges: Edge[] = [
      { id: 'a', source: 's-a', target: 't-a', type: 'smoothstep' } as Edge,
      { id: 'b', source: 's-a', target: 't-b', type: 'smoothstep' } as Edge,
      { id: 'c', source: 's-b', target: 't-a', type: 'smoothstep' } as Edge,
      {
        id: 'd',
        source: 's-b',
        target: 't-b',
        data: { relation: 'invalidates', dim: true, highlighted: true, laneOffset: 12 },
        type: 'smoothstep',
      } as Edge,
    ];

    const result = applyEdgeGeometryLanes(nodes, edges);
    const byId = new Map(result.map((edge) => [edge.id, edge]));

    expect(byId.get('a')?.data).toMatchObject({ relation: 'invalidates', dim: false, highlighted: false });
    expect(byId.get('b')?.data?.laneOffset).not.toBe(byId.get('a')?.data?.laneOffset);
    expect(byId.get('c')?.data?.laneOffset).not.toBe(byId.get('a')?.data?.laneOffset);
    expect(byId.get('d')?.data).toMatchObject({ relation: 'invalidates', dim: true, highlighted: true });
  });

  it('uses default centers and data fallbacks when collision edges reference sparse nodes', () => {
    const nodes: Node[] = [
      { id: 'source', type: 'rqvNode', data: {}, position: { x: 0, y: 0 } },
      { id: 'target', type: 'rqvNode', data: {}, position: { x: 320, y: 0 } },
    ];
    const edges: Edge[] = [
      { id: 'a', source: 'source', target: 'target', type: 'smoothstep' } as Edge,
      { id: 'b', source: 'source', target: 'target', type: 'smoothstep' } as Edge,
      { id: 'c', source: 'source', target: 'target', type: 'smoothstep' } as Edge,
      { id: 'missing-source', source: 'missing-source', target: 'target', type: 'smoothstep' } as Edge,
      { id: 'missing-target', source: 'source', target: 'missing-target', type: 'smoothstep' } as Edge,
    ];

    const result = applyEdgeGeometryLanes(nodes, edges);
    const byId = new Map(result.map((edge) => [edge.id, edge]));

    expect(byId.get('a')?.data).toMatchObject({ relation: 'invalidates', dim: false, highlighted: false });
    expect(byId.get('a')?.data?.laneOffset).not.toBe(byId.get('b')?.data?.laneOffset);
    expect(byId.get('missing-source')?.data).toMatchObject({ relation: 'invalidates' });
    expect(byId.get('missing-target')?.data).toMatchObject({ relation: 'invalidates' });
  });

  it('falls back to zero when a lane-sort comparator references a node not in the node list', () => {
    // Multiple edges share the same source (same sourceKey group), with some targets
    // not present in the node array. This forces centerYById.get(b.target) to return
    // undefined, exercising the `?? 0` fallback in the source-lane sort comparator.
    // Similarly, multiple edges share the same target, with some sources missing from
    // the node array, exercising the target-lane sort comparator fallback.
    const nodes: Node[] = [
      { id: 'source', type: 'rqvNode', data: {}, position: { x: 0, y: 100 }, height: 40 },
      { id: 'known-target', type: 'rqvNode', data: {}, position: { x: 400, y: 200 }, height: 40 },
      { id: 'known-source', type: 'rqvNode', data: {}, position: { x: 0, y: 300 }, height: 40 },
      { id: 'shared-target', type: 'rqvNode', data: {}, position: { x: 400, y: 400 }, height: 40 },
    ];
    const edges: Edge[] = [
      // Two edges from the same source to different targets — one target is missing from nodes.
      // The sort comparator for groupedBySource will call centerYById.get('ghost-target') → undefined → 0.
      { id: 'src-known', source: 'source', target: 'known-target', type: 'smoothstep' } as Edge,
      { id: 'src-ghost', source: 'source', target: 'ghost-target', type: 'smoothstep' } as Edge,
      // Two edges from different sources to the same target — one source is missing.
      // The sort comparator for groupedByTarget will call centerYById.get('ghost-source') → undefined → 0.
      { id: 'ghost-src', source: 'ghost-source', target: 'shared-target', type: 'smoothstep' } as Edge,
      { id: 'known-src', source: 'known-source', target: 'shared-target', type: 'smoothstep' } as Edge,
    ];

    const result = applyEdgeGeometryLanes(nodes, edges);
    expect(result).toHaveLength(4);
    // All edges should have their lane offsets set (no crash from undefined lookups).
    const byId = new Map(result.map((edge) => [edge.id, edge]));
    expect(typeof byId.get('src-known')?.data?.laneOffset).toBe('number');
    expect(typeof byId.get('src-ghost')?.data?.laneOffset).toBe('number');
    expect(typeof byId.get('ghost-src')?.data?.laneOffset).toBe('number');
    expect(typeof byId.get('known-src')?.data?.laneOffset).toBe('number');
    // The two edges from the same source should get different lane offsets.
    expect(byId.get('src-known')?.data?.laneOffset).not.toBe(byId.get('src-ghost')?.data?.laneOffset);
    // The two edges to the same target should get different lane offsets.
    expect(byId.get('ghost-src')?.data?.laneOffset).not.toBe(byId.get('known-src')?.data?.laneOffset);
  });

  it('falls back to zero for both a and b when all targets and sources in a group are absent from the node list', () => {
    // Force aY fallback (centerYById.get(a.target) === undefined) by making BOTH targets
    // in the source group absent from the nodes list.
    // Force aY source fallback (centerYById.get(a.source) === undefined) similarly.
    const nodes: Node[] = [
      // Shared source and shared target are NOT in this list so all ?? 0 branches are taken.
    ];
    const edges: Edge[] = [
      // Two edges from ghost-src to two different ghost targets — source-lane sort: both aY and bY ?? 0.
      { id: 'e1', source: 'ghost-src', target: 'ghost-t1', type: 'smoothstep' } as Edge,
      { id: 'e2', source: 'ghost-src', target: 'ghost-t2', type: 'smoothstep' } as Edge,
      // Two edges from two ghost sources to ghost-target — target-lane sort: both aY and bY ?? 0.
      { id: 'e3', source: 'ghost-s1', target: 'ghost-target', type: 'smoothstep' } as Edge,
      { id: 'e4', source: 'ghost-s2', target: 'ghost-target', type: 'smoothstep' } as Edge,
    ];

    const result = applyEdgeGeometryLanes(nodes, edges);
    expect(result).toHaveLength(4);
    const byId = new Map(result.map((edge) => [edge.id, edge]));
    // When aY === bY === 0, the sort falls through to id comparison — different lanes are still assigned.
    expect(byId.get('e1')?.data?.laneOffset).not.toBe(byId.get('e2')?.data?.laneOffset);
    expect(byId.get('e3')?.data?.laneOffset).not.toBe(byId.get('e4')?.data?.laneOffset);
  });
});
