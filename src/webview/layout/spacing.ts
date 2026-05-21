export const DEFAULT_NODE_HEIGHT = 173;
export const PROJECT_TOP_DIVIDER_GAP = 42;
export const PROJECT_BAND_GAP = 8;
export const FILE_ACTION_PROJECT_GAP = 48;
export const PROJECT_COLUMN_GAP = 168;
export const MONOREPO_PROJECT_ROW_GAP = 96;
export const MONOREPO_PROJECT_MAX_COLUMNS = 4;
export const DECLARE_ACTION_QUERY_GAP = 56;
export const PROJECT_DIVIDER_TOP_MARGIN = 23;
export const PROJECT_DIVIDER_BOTTOM_MARGIN = 11;
export const PROJECT_DIVIDER_LABEL_TOP_OFFSET = 20;
export const LANE_COLUMN_BUCKET_SIZE = 96;
export const LANE_VALUE_BUCKET_SIZE = 14;
export const LANE_COLLISION_SPREAD = 18;

const VERTICAL_SPACING_MIN = 0;
const VERTICAL_SPACING_MAX = 300;
const HORIZONTAL_SPACING_MIN = 100;
const HORIZONTAL_SPACING_MAX = 3000;

export function resolveVerticalRowGap(verticalSpacing: number): number {
  return Math.max(0, Math.round(verticalSpacing));
}

export function clampVerticalSpacing(value: number): number {
  return Math.max(VERTICAL_SPACING_MIN, Math.min(VERTICAL_SPACING_MAX, Math.round(value)));
}

export function clampHorizontalSpacing(value: number): number {
  return Math.max(HORIZONTAL_SPACING_MIN, Math.min(HORIZONTAL_SPACING_MAX, Math.round(value)));
}
