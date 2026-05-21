export function normalizePathSegments(input: string): string[] {
  return input.split('/').filter(Boolean);
}

export function stripWorkspacePrefix(filePath: string, workspace: string): string {
  if (!workspace) {
    return filePath;
  }

  const prefix = `${workspace}/`;
  if (!filePath.startsWith(prefix)) {
    return filePath;
  }

  return filePath.slice(prefix.length);
}

export function parseProjectScope(metricScope: unknown): { root: string; project: string } | null {
  if (typeof metricScope !== 'string') {
    return null;
  }

  const colonIndex = metricScope.indexOf(':');
  if (colonIndex < 0) {
    const normalized = metricScope.trim();
    if (!normalized) {
      return null;
    }

    return { root: '', project: normalized };
  }

  const root = metricScope.slice(0, colonIndex).trim();
  const suffix = metricScope.slice(colonIndex + 1).trim();
  if (!suffix || suffix === '.' || suffix === '*') {
    return { root, project: root || 'workspace' };
  }

  return { root, project: suffix };
}

export function projectLabelFromScope(metricScope: unknown): string | null {
  const parsed = parseProjectScope(metricScope);
  if (!parsed) {
    return null;
  }

  if (parsed.root && parsed.project && parsed.project !== parsed.root) {
    return `${parsed.root}/${parsed.project}`;
  }

  return parsed.project || parsed.root || null;
}

export function inferProjectFromPath(filePath: string, workspace: string): string {
  const scopedPath = stripWorkspacePrefix(filePath, workspace);
  const segments = normalizePathSegments(scopedPath);
  if (segments.length >= 2) {
    return `${segments[0]}/${segments[1]}`;
  }
  if (segments.length === 1) {
    return segments[0];
  }

  return workspace || 'workspace';
}

export function makeProjectRelativePath(filePath: string, workspace: string, project: string): string {
  const scopedPath = stripWorkspacePrefix(filePath, workspace);
  const pathSegments = normalizePathSegments(scopedPath);
  const projectSegments = normalizePathSegments(project);

  if (pathSegments.length === 0) {
    return filePath;
  }

  const matchesPrefix =
    projectSegments.length > 0 &&
    projectSegments.every((segment, index) => pathSegments[index] && pathSegments[index] === segment);

  if (!matchesPrefix) {
    return scopedPath;
  }

  const remainder = pathSegments.slice(projectSegments.length).join('/');
  return remainder || pathSegments[pathSegments.length - 1] || scopedPath;
}
