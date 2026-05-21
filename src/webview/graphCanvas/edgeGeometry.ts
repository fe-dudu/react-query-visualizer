import type { Edge, Node } from '@xyflow/react';

import { LANE_COLLISION_SPREAD, LANE_COLUMN_BUCKET_SIZE, LANE_VALUE_BUCKET_SIZE } from './spacing';
import type { FlowEdgeData } from '../viewTypes';

function nodeCenterYMap(nodes: Node[]): Map<string, number> {
  const centerYById = new Map<string, number>();
  for (const node of nodes) {
    const nodeHeight = node.measured?.height ?? node.height ?? 173;
    centerYById.set(node.id, node.position.y + nodeHeight / 2);
  }

  return centerYById;
}

function nodeCenterXMap(nodes: Node[]): Map<string, number> {
  const centerXById = new Map<string, number>();
  for (const node of nodes) {
    const nodeWidth = node.measured?.width ?? node.width ?? 340;
    centerXById.set(node.id, node.position.x + nodeWidth / 2);
  }

  return centerXById;
}

function edgeRelationKey(edge: Edge): string {
  const edgeData = edge.data as FlowEdgeData | undefined;
  return edgeData?.relation ?? 'invalidates';
}

function relationLaneBand(relation: string): number {
  if (relation === 'declares') {
    return -132;
  }
  if (relation === 'sets') {
    return 140;
  }
  if (relation === 'removes') {
    return 112;
  }
  if (relation === 'resets') {
    return 84;
  }
  if (relation === 'clears') {
    return 28;
  }
  if (relation === 'cancels') {
    return -56;
  }
  if (relation === 'refetches') {
    return -28;
  }
  if (relation === 'invalidates') {
    return -84;
  }

  return 0;
}

function assignLaneOffsetsByGroup(
  groupedEdges: Map<string, Edge[]>,
  sortFn: (edgeA: Edge, edgeB: Edge) => number,
  step: number,
): Map<string, number> {
  const laneByEdgeId = new Map<string, number>();

  for (const group of groupedEdges.values()) {
    const sorted = [...group].sort(sortFn);
    const centerIndex = (sorted.length - 1) / 2;
    for (const [index, edge] of sorted.entries()) {
      laneByEdgeId.set(edge.id, (index - centerIndex) * step);
    }
  }

  return laneByEdgeId;
}

function resolveLaneCollisions(nodes: Node[], edges: Edge[]): Edge[] {
  const centerXById = nodeCenterXMap(nodes);
  const buckets = new Map<string, Edge[]>();

  for (const edge of edges) {
    const edgeData = edge.data as FlowEdgeData | undefined;
    const laneOffset = Number(edgeData?.laneOffset ?? 0);
    const relation = edgeRelationKey(edge);
    const sourceColumn = Math.round((centerXById.get(edge.source) ?? 0) / LANE_COLUMN_BUCKET_SIZE);
    const targetColumn = Math.round((centerXById.get(edge.target) ?? 0) / LANE_COLUMN_BUCKET_SIZE);
    const laneBucket = Math.round(laneOffset / LANE_VALUE_BUCKET_SIZE);
    const key = `${relation}:${sourceColumn}:${targetColumn}:${laneBucket}`;
    const group = buckets.get(key) ?? [];
    group.push(edge);
    buckets.set(key, group);
  }

  const laneDeltaByEdgeId = new Map<string, number>();
  for (const group of buckets.values()) {
    if (group.length < 2) {
      continue;
    }

    const sorted = [...group].sort(
      (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.id.localeCompare(b.id),
    );
    const centerIndex = (sorted.length - 1) / 2;
    for (const [index, edge] of sorted.entries()) {
      const delta = (index - centerIndex) * LANE_COLLISION_SPREAD;
      if (delta !== 0) {
        laneDeltaByEdgeId.set(edge.id, delta);
      }
    }
  }

  if (laneDeltaByEdgeId.size === 0) {
    return edges;
  }

  return edges.map((edge) => {
    const laneDelta = laneDeltaByEdgeId.get(edge.id);
    if (typeof laneDelta !== 'number') {
      return edge;
    }

    const edgeData = edge.data as FlowEdgeData | undefined;
    return {
      ...edge,
      data: {
        relation: edgeData?.relation ?? (edgeRelationKey(edge) as FlowEdgeData['relation']),
        dim: edgeData?.dim ?? false,
        highlighted: edgeData?.highlighted ?? false,
        laneOffset: Number(edgeData?.laneOffset ?? 0) + laneDelta,
      } satisfies FlowEdgeData,
    };
  });
}

export function applyEdgeGeometryLanes(nodes: Node[], edges: Edge[]): Edge[] {
  const centerYById = nodeCenterYMap(nodes);
  const groupedBySource = new Map<string, Edge[]>();
  const groupedByTarget = new Map<string, Edge[]>();

  for (const edge of edges) {
    const relation = edgeRelationKey(edge);

    const sourceKey = `${edge.source}:${relation}`;
    const sourceList = groupedBySource.get(sourceKey) ?? [];
    sourceList.push(edge);
    groupedBySource.set(sourceKey, sourceList);

    const targetKey = `${edge.target}:${relation}`;
    const targetList = groupedByTarget.get(targetKey) ?? [];
    targetList.push(edge);
    groupedByTarget.set(targetKey, targetList);
  }

  const sourceLaneByEdgeId = assignLaneOffsetsByGroup(
    groupedBySource,
    (a, b) => {
      const aY = centerYById.get(a.target) ?? 0;
      const bY = centerYById.get(b.target) ?? 0;
      if (aY !== bY) {
        return aY - bY;
      }

      return a.id.localeCompare(b.id);
    },
    58,
  );

  const targetLaneByEdgeId = assignLaneOffsetsByGroup(
    groupedByTarget,
    (a, b) => {
      const aY = centerYById.get(a.source) ?? 0;
      const bY = centerYById.get(b.source) ?? 0;
      if (aY !== bY) {
        return aY - bY;
      }

      return a.id.localeCompare(b.id);
    },
    58,
  );

  const laneAdjustedEdges = edges.map((edge) => {
    const relation = edgeRelationKey(edge);
    const sourceLane = sourceLaneByEdgeId.get(edge.id) ?? 0;
    const targetLane = targetLaneByEdgeId.get(edge.id) ?? 0;
    const laneOffset = sourceLane + targetLane + relationLaneBand(relation);
    const edgeData = edge.data as FlowEdgeData | undefined;

    return {
      ...edge,
      data: {
        relation: edgeData?.relation ?? (relation as FlowEdgeData['relation']),
        dim: edgeData?.dim ?? false,
        highlighted: edgeData?.highlighted ?? false,
        laneOffset,
      } satisfies FlowEdgeData,
    };
  });

  return resolveLaneCollisions(nodes, laneAdjustedEdges);
}

export function minimumNodeY(nodes: Node[]): number | null {
  let minY = Number.POSITIVE_INFINITY;

  for (const node of nodes) {
    if (node.id.startsWith('divider:')) {
      continue;
    }
    minY = Math.min(minY, node.position.y);
  }

  if (!Number.isFinite(minY)) {
    return null;
  }

  return minY;
}
