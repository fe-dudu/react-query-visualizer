import type { ScannedFile } from '../types/model';

export interface FileTreeDirectory {
  name: string;
  path: string;
  impact: number;
  directories: Map<string, FileTreeDirectory>;
  files: ScannedFile[];
}

function normalizePathSegments(input: string): string[] {
  return input.split('/').filter(Boolean);
}

export function buildFileTree(relatedFiles: ScannedFile[]): FileTreeDirectory {
  const root: FileTreeDirectory = {
    name: '',
    path: '',
    impact: 0,
    directories: new Map(),
    files: [],
  };

  for (const file of relatedFiles) {
    const project = (file.project ?? file.workspace) || 'workspace';
    const relativePath = file.projectRelativePath ?? file.path;
    const segments = normalizePathSegments(relativePath);
    const impact = Number(file.impact ?? 0);

    let projectDirectory = root.directories.get(project);
    if (!projectDirectory) {
      projectDirectory = {
        name: project,
        path: project,
        impact: 0,
        directories: new Map(),
        files: [],
      };
      root.directories.set(project, projectDirectory);
    }
    projectDirectory.impact += impact;

    if (segments.length === 0) {
      continue;
    }

    let current = projectDirectory;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      if (!segment) {
        continue;
      }

      const segmentPath = `${project}/${segments.slice(0, index + 1).join('/')}`;
      const existing = current.directories.get(segment);
      if (existing) {
        existing.impact += impact;
        current = existing;
        continue;
      }

      const nextDirectory: FileTreeDirectory = {
        name: segment,
        path: segmentPath,
        impact,
        directories: new Map(),
        files: [],
      };
      current.directories.set(segment, nextDirectory);
      current = nextDirectory;
    }

    current.files.push(file);
  }

  return root;
}

export function displayFileName(pathValue: string): string {
  const segments = normalizePathSegments(pathValue);
  return segments[segments.length - 1] ?? pathValue;
}

export function directoryImpact(directory: FileTreeDirectory): number {
  return directory.impact;
}

export function collectDirectoryPaths(root: FileTreeDirectory): Set<string> {
  const paths = new Set<string>();

  const visit = (directory: FileTreeDirectory) => {
    for (const child of directory.directories.values()) {
      paths.add(child.path);
      visit(child);
    }
  };

  visit(root);
  return paths;
}
