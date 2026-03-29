export interface ProjectBounds {
  project: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ProjectShift {
  x: number;
  y: number;
}

export interface ProjectGridOptions {
  columnGap: number;
  rowGap: number;
  maxColumns: number;
}

export interface ProjectBubbleFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeProjectGridShifts(
  projects: ProjectBounds[],
  options: ProjectGridOptions,
): Map<string, ProjectShift> {
  if (projects.length <= 1) {
    return new Map();
  }

  const sortedProjects = [...projects].sort(
    (left, right) => left.minX - right.minX || left.minY - right.minY || left.project.localeCompare(right.project),
  );
  const frameByProject = new Map(
    sortedProjects.map((project) => [project.project, computeProjectBubbleFrame(project)]),
  );
  const baselineX = sortedProjects.reduce((minX, project) => {
    const frame = frameByProject.get(project.project);
    return Math.min(minX, frame?.x ?? project.minX);
  }, Number.POSITIVE_INFINITY);
  const baselineY = sortedProjects.reduce((minY, project) => {
    const frame = frameByProject.get(project.project);
    return Math.min(minY, frame?.y ?? project.minY);
  }, Number.POSITIVE_INFINITY);

  if (!Number.isFinite(baselineX) || !Number.isFinite(baselineY)) {
    return new Map();
  }

  const maxColumns = Math.max(1, Math.floor(options.maxColumns));
  const shifts = new Map<string, ProjectShift>();
  let cursorY = baselineY;

  for (let startIndex = 0; startIndex < sortedProjects.length; startIndex += maxColumns) {
    const rowProjects = sortedProjects.slice(startIndex, startIndex + maxColumns);
    let cursorX = baselineX;
    let rowHeight = 0;

    for (const project of rowProjects) {
      const frame = frameByProject.get(project.project) ?? computeProjectBubbleFrame(project);
      shifts.set(project.project, {
        x: cursorX - frame.x,
        y: cursorY - frame.y,
      });

      cursorX += frame.width + options.columnGap;
      rowHeight = Math.max(rowHeight, frame.height);
    }

    cursorY += rowHeight + options.rowGap;
  }

  return shifts;
}

export function computeProjectBubbleFrame(
  bounds: Pick<ProjectBounds, 'minX' | 'maxX' | 'minY' | 'maxY'>,
  options?: {
    horizontalPadding?: number;
    topPadding?: number;
    bottomPadding?: number;
    minWidth?: number;
    minHeight?: number;
  },
): ProjectBubbleFrame {
  const horizontalPadding = options?.horizontalPadding ?? 56;
  const topPadding = options?.topPadding ?? 72;
  const bottomPadding = options?.bottomPadding ?? 44;
  const minWidth = options?.minWidth ?? 420;
  const minHeight = options?.minHeight ?? 220;

  return {
    x: bounds.minX - horizontalPadding,
    y: bounds.minY - topPadding,
    width: Math.max(minWidth, bounds.maxX - bounds.minX + horizontalPadding * 2),
    height: Math.max(minHeight, bounds.maxY - bounds.minY + topPadding + bottomPadding),
  };
}
