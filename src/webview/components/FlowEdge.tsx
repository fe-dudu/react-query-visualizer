import { BaseEdge, type EdgeProps } from '@xyflow/react';

import { RELATION_COLOR } from '../constants';
import type { GraphRelation } from '../model';
import type { FlowEdgeData } from '../viewTypes';

const EDGE_BASE_OFFSET = 36;
const MAX_LANE_OFFSET = 520;
const MAX_BRANCH_OFFSET = 240;
const EDGE_FLOW_DASH = '18 14';
function clampLaneOffset(value: number): number {
  if (value > MAX_LANE_OFFSET) {
    return MAX_LANE_OFFSET;
  }
  if (value < -MAX_LANE_OFFSET) {
    return -MAX_LANE_OFFSET;
  }

  return value;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }

  return value;
}

function buildForceCurvePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  laneOffset: number,
): string {
  const deltaX = targetX - sourceX;
  const direction = deltaX >= 0 ? 1 : -1;
  const distanceX = Math.max(1, Math.abs(deltaX));
  const spreadY = clamp(laneOffset, -MAX_BRANCH_OFFSET, MAX_BRANCH_OFFSET);
  const curvatureX = clamp(distanceX * 0.34, 72, 340);
  const sourceCtrlX = sourceX + curvatureX * direction;
  const sourceCtrlY = sourceY + spreadY;
  const targetCtrlX = targetX - curvatureX * direction;
  const targetCtrlY = targetY - spreadY * 0.28;

  return `M ${sourceX},${sourceY} C ${sourceCtrlX},${sourceCtrlY} ${targetCtrlX},${targetCtrlY} ${targetX},${targetY}`;
}

function relationFromData(value: GraphRelation | undefined): GraphRelation {
  return value ?? 'invalidates';
}

export function RqvFlowEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps) {
  const edgeData = data as FlowEdgeData | undefined;
  const relation = relationFromData(edgeData?.relation);
  const laneOffset = clampLaneOffset(Number(edgeData?.laneOffset ?? 0));
  const highlighted = edgeData?.highlighted ?? false;
  const dim = edgeData?.dim ?? false;
  const laneDistance = Math.abs(laneOffset);
  const effectiveLaneOffset = laneOffset * (1 + laneDistance / (EDGE_BASE_OFFSET * 4));
  const edgePath = buildForceCurvePath(sourceX, sourceY, targetX, targetY, effectiveLaneOffset);

  const stroke = RELATION_COLOR[relation];
  let opacity = 0.96;
  if (dim) {
    opacity = 0.12;
  } else if (highlighted) {
    opacity = 1;
  }
  const strokeWidth = highlighted ? 4.8 : 3.1;

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      className={highlighted ? 'rqv-edge-flow' : undefined}
      style={{
        stroke,
        strokeWidth,
        opacity,
        strokeDasharray: highlighted ? EDGE_FLOW_DASH : undefined,
        strokeDashoffset: highlighted ? 0 : undefined,
        filter: highlighted ? `drop-shadow(0 0 7px ${stroke})` : 'none',
        strokeLinecap: 'round',
      }}
    />
  );
}
