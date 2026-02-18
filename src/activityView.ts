import * as vscode from 'vscode';

import type { WebviewPayload } from './types';

interface LastScanSummary {
  parseErrors: number;
  relatedFilesTree: ActivityNode[];
}

class ActivityNode extends vscode.TreeItem {
  readonly children: ActivityNode[];

  constructor(
    label: string,
    options: {
      id?: string;
      description?: string;
      tooltip?: string;
      icon?: string;
      command?: vscode.Command;
      collapsibleState?: vscode.TreeItemCollapsibleState;
      children?: ActivityNode[];
    } = {},
  ) {
    super(label, options.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
    this.id = options.id;
    this.description = options.description;
    this.tooltip = options.tooltip;
    if (options.icon) {
      this.iconPath = new vscode.ThemeIcon(options.icon);
    }
    if (options.command) {
      this.command = options.command;
    }
    this.children = options.children ?? [];
  }
}

function actionNode(label: string, command: string, icon: string): ActivityNode {
  return new ActivityNode(label, {
    id: `rqv:action:${command}`,
    icon,
    command: {
      command,
      title: label,
    },
  });
}

interface RelatedFileNode {
  name: string;
  path: string;
  impact: number;
  directories: Map<string, RelatedFileNode>;
  files: Array<{
    name: string;
    labelPath: string;
    impact: number;
    project: string;
    projectRelativePath: string;
    absolutePath?: string;
  }>;
}

function normalizePathSegments(input: string): string[] {
  return input.split('/').filter(Boolean);
}

function stripWorkspacePrefix(filePath: string, workspace: string): string {
  if (!workspace) {
    return filePath;
  }

  const prefix = `${workspace}/`;
  if (!filePath.startsWith(prefix)) {
    return filePath;
  }

  return filePath.slice(prefix.length);
}

function parseProjectScope(metricScope: unknown): { root: string; project: string } | null {
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

function inferProjectFromPath(filePath: string, workspace: string): string {
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

function projectRelativePath(filePath: string, workspace: string, project: string): string {
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

function buildRelatedFilesTree(
  files: Array<{
    labelPath: string;
    impact: number;
    project: string;
    projectRelativePath: string;
    absolutePath?: string;
  }>,
): RelatedFileNode {
  const root: RelatedFileNode = {
    name: '',
    path: '',
    impact: 0,
    directories: new Map(),
    files: [],
  };

  for (const file of files) {
    const segments = normalizePathSegments(file.projectRelativePath);
    const impact = Number(file.impact ?? 0);

    let projectNode = root.directories.get(file.project);
    if (!projectNode) {
      projectNode = {
        name: file.project,
        path: file.project,
        impact: 0,
        directories: new Map(),
        files: [],
      };
      root.directories.set(file.project, projectNode);
    }
    projectNode.impact += impact;

    if (segments.length === 0) {
      continue;
    }

    let current = projectNode;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      if (!segment) {
        continue;
      }

      const segmentPath = `${file.project}/${segments.slice(0, index + 1).join('/')}`;
      const existing = current.directories.get(segment);
      if (existing) {
        existing.impact += impact;
        current = existing;
        continue;
      }

      const nextDirectory: RelatedFileNode = {
        name: segment,
        path: segmentPath,
        impact,
        directories: new Map(),
        files: [],
      };
      current.directories.set(segment, nextDirectory);
      current = nextDirectory;
    }

    const fileName = segments[segments.length - 1] ?? file.labelPath;
    current.files.push({
      name: fileName,
      labelPath: file.labelPath,
      impact,
      project: file.project,
      projectRelativePath: file.projectRelativePath,
      absolutePath: file.absolutePath,
    });
  }

  return root;
}

function directoryToActivityNodes(directory: RelatedFileNode): ActivityNode[] {
  const nodes: ActivityNode[] = [];
  const childDirectories = [...directory.directories.values()].sort(
    (a, b) => b.impact - a.impact || a.name.localeCompare(b.name),
  );
  const childFiles = [...directory.files].sort((a, b) => b.impact - a.impact || a.labelPath.localeCompare(b.labelPath));

  for (const childDirectory of childDirectories) {
    const children = directoryToActivityNodes(childDirectory);
    nodes.push(
      new ActivityNode(childDirectory.name, {
        id: `rqv:dir:${childDirectory.path}`,
        description: `Q${childDirectory.impact}`,
        icon: 'folder',
        collapsibleState:
          children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
        children,
        tooltip: childDirectory.path,
      }),
    );
  }

  for (const file of childFiles) {
    nodes.push(
      new ActivityNode(file.name, {
        id: `rqv:file:${file.labelPath}`,
        description: `Q${file.impact}`,
        icon: 'file',
        tooltip: file.labelPath,
        command: file.absolutePath
          ? {
              command: 'rqv.revealInCode',
              title: 'Reveal In Code',
              arguments: [{ file: file.absolutePath, line: 1, column: 1 }],
            }
          : undefined,
      }),
    );
  }

  return nodes;
}

function createRelatedFilesRoot(payload: WebviewPayload): ActivityNode {
  const workspaceByPath = new Map(payload.scannedFiles.map((file) => [file.path, file.workspace]));
  const workspaceCount = new Set(payload.scannedFiles.map((file) => file.workspace).filter(Boolean)).size;
  const multiWorkspace = workspaceCount > 1;
  const fileNodes = payload.graph.nodes
    .filter((node) => node.kind === 'file')
    .map((node) => ({
      labelPath: node.label,
      impact: Number(node.metrics?.affectedKeys ?? 0),
      project: (() => {
        const workspace = workspaceByPath.get(node.label) ?? '';
        const parsedScope = parseProjectScope(node.metrics?.projectScope);
        const baseProject = parsedScope?.project ?? inferProjectFromPath(node.label, workspace);
        return multiWorkspace && workspace ? `${workspace}/${baseProject}` : baseProject;
      })(),
      projectRelativePath: (() => {
        const workspace = workspaceByPath.get(node.label) ?? '';
        const parsedScope = parseProjectScope(node.metrics?.projectScope);
        const baseProject = parsedScope?.project ?? inferProjectFromPath(node.label, workspace);
        return projectRelativePath(node.label, workspace, baseProject);
      })(),
      absolutePath: node.file,
    }))
    .sort((a, b) => b.impact - a.impact || a.labelPath.localeCompare(b.labelPath));

  const tree = buildRelatedFilesTree(fileNodes);
  const children = directoryToActivityNodes(tree);
  const summaryDescription = `${payload.graph.summary.files} files · ${payload.graph.summary.actions} actions · ${payload.graph.summary.queryKeys} keys`;

  return new ActivityNode('Related Files', {
    id: 'rqv:related-files-root',
    description: summaryDescription,
    tooltip: `${summaryDescription}\n${payload.scopeLabel}`,
    icon: 'files',
    collapsibleState:
      children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    children,
  });
}

export class RqvActivityViewProvider implements vscode.TreeDataProvider<ActivityNode> {
  private readonly emitter = new vscode.EventEmitter<ActivityNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private lastScan?: LastScanSummary;

  getTreeItem(element: ActivityNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ActivityNode): vscode.ProviderResult<ActivityNode[]> {
    if (element) {
      return element.children;
    }

    const actions: ActivityNode[] = [
      actionNode('Scan Now', 'rqv.scanNow', 'search'),
      actionNode('Scan With Scope', 'rqv.scanWithScope', 'folder-opened'),
      actionNode('Open Graph Panel', 'rqv.openGraphPanel', 'graph'),
    ];

    if (!this.lastScan) {
      actions.push(
        new ActivityNode('No scan result yet', {
          description: 'Run scan to populate graph',
          icon: 'info',
          tooltip: 'Run React Query Visualizer: Scan Now or React Query Visualizer: Scan With Scope.',
        }),
      );
      return actions;
    }

    const summary = this.lastScan;
    actions.push(
      new ActivityNode('Parse Errors', {
        id: 'rqv:parse-errors',
        description: String(summary.parseErrors),
        icon: summary.parseErrors > 0 ? 'warning' : 'check',
      }),
      summary.relatedFilesTree[0] ??
        new ActivityNode('Related Files', {
          id: 'rqv:related-files-empty',
          description: '0',
          icon: 'files',
        }),
    );

    return actions;
  }

  updateFromPayload(payload: WebviewPayload): void {
    const relatedFilesRoot = createRelatedFilesRoot(payload);
    this.lastScan = {
      parseErrors: payload.graph.summary.parseErrors,
      relatedFilesTree: [relatedFilesRoot],
    };
    this.refresh();
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }
}
