import * as path from 'node:path';
import * as vscode from 'vscode';

import { getScanScopeConfig } from './config';
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE } from './glob';
import type { ScanScope } from '../types';

function toRelativeFolder(rootPath: string, absolutePath: string): string {
  const rel = path.relative(rootPath, absolutePath);
  if (!rel || rel === '.') {
    return '.';
  }

  if (rel.startsWith('..')) {
    return absolutePath;
  }

  return rel.split(path.sep).join('/');
}

export async function promptScope(workspaceFolder: vscode.WorkspaceFolder): Promise<ScanScope | undefined> {
  const current = getScanScopeConfig();
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: true,
    canSelectFiles: false,
    canSelectFolders: true,
    defaultUri: workspaceFolder.uri,
    openLabel: 'Select folders to scan',
  });

  if (!uris) {
    return undefined;
  }

  const includeGlob = await vscode.window.showInputBox({
    title: 'React Query Visualizer Include Glob',
    prompt: 'Comma-separated include patterns',
    value: current.includeGlob || DEFAULT_INCLUDE,
    valueSelection: [0, (current.includeGlob || DEFAULT_INCLUDE).length],
  });
  if (includeGlob === undefined) {
    return undefined;
  }

  const excludeGlob = await vscode.window.showInputBox({
    title: 'React Query Visualizer Exclude Glob',
    prompt: 'Comma-separated exclude patterns',
    value: current.excludeGlob || DEFAULT_EXCLUDE,
    valueSelection: [0, (current.excludeGlob || DEFAULT_EXCLUDE).length],
  });
  if (excludeGlob === undefined) {
    return undefined;
  }

  const folders = uris.map((uri) => toRelativeFolder(workspaceFolder.uri.fsPath, uri.fsPath));

  return {
    folders,
    includeGlob,
    excludeGlob,
    useGitIgnore: current.useGitIgnore,
    maxFileSizeKB: current.maxFileSizeKB,
  };
}

export function scopeToLabel(scope: ScanScope): string {
  const folders = scope.folders.length > 0 ? scope.folders.join(', ') : '.';
  return `Folders: ${folders} | Include: ${scope.includeGlob} | Exclude: ${scope.excludeGlob}`;
}
