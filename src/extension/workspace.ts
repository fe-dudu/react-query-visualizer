import * as path from 'node:path';
import * as vscode from 'vscode';

import type { ScanScope } from '../types';

export function getWorkspaceFolders(): vscode.WorkspaceFolder[] {
  return [...(vscode.workspace.workspaceFolders ?? [])];
}

function normalizeFolderForWorkspace(folder: string, workspaceRoot: string): string | undefined {
  if (!path.isAbsolute(folder)) {
    return folder;
  }

  const relative = path.relative(workspaceRoot, folder);
  const inWorkspace = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  if (!inWorkspace) {
    return undefined;
  }

  if (!relative) {
    return '.';
  }

  return relative.split(path.sep).join('/');
}

export function scopeForWorkspace(scope: ScanScope, workspace: vscode.WorkspaceFolder): ScanScope | undefined {
  if (scope.folders.length === 0) {
    return scope;
  }

  const mapped = scope.folders
    .map((folder) => normalizeFolderForWorkspace(folder, workspace.uri.fsPath))
    .filter((value): value is string => Boolean(value));

  if (mapped.length === 0) {
    return undefined;
  }

  return {
    ...scope,
    folders: [...new Set(mapped)],
  };
}

export function getDefaultScopeWorkspace(workspaces: vscode.WorkspaceFolder[]): vscode.WorkspaceFolder {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const activeWorkspace = vscode.workspace.getWorkspaceFolder(activeUri);
    if (activeWorkspace) {
      return activeWorkspace;
    }
  }

  return workspaces[0];
}
