import { afterEach, describe, expect, it, vi } from 'vitest';

import * as vscode from '../../../testing/vscode';

vi.mock('vscode', async () => await import('../../../testing/vscode'));

const workspaceFolders = [
  { name: 'app', uri: { fsPath: '/repo/app' } },
  { name: 'core', uri: { fsPath: '/repo/core' } },
];

afterEach(() => {
  vscode.workspace.workspaceFolders = undefined as never;
  vscode.workspace.getWorkspaceFolder = undefined as never;
  vscode.window.activeTextEditor = undefined;
});

describe('extension/workspace/folders', () => {
  it('returns workspace folders and scopes relative paths', async () => {
    vscode.workspace.workspaceFolders = workspaceFolders as never;
    vscode.workspace.getWorkspaceFolder = () => workspaceFolders[0] as never;
    vscode.window.activeTextEditor = undefined;

    const { getDefaultScopeWorkspace, getWorkspaceFolders, scopeForWorkspace } = await import('../folders');

    expect(getWorkspaceFolders()).toEqual(workspaceFolders);
    vscode.workspace.workspaceFolders = undefined as never;
    expect(getWorkspaceFolders()).toEqual([]);
    vscode.workspace.workspaceFolders = workspaceFolders as never;
    expect(
      scopeForWorkspace(
        {
          folders: [],
          includeGlob: '**/*.ts',
          excludeGlob: '**/dist/**',
          useGitIgnore: true,
          maxFileSizeKB: 128,
        },
        workspaceFolders[0] as never,
      ),
    ).toEqual({
      folders: [],
      includeGlob: '**/*.ts',
      excludeGlob: '**/dist/**',
      useGitIgnore: true,
      maxFileSizeKB: 128,
    });
    expect(
      scopeForWorkspace(
        {
          folders: ['local', '/repo/app/src', '/outside/project'],
          includeGlob: '**/*.ts',
          excludeGlob: '**/dist/**',
          useGitIgnore: true,
          maxFileSizeKB: 128,
        },
        workspaceFolders[0] as never,
      ),
    ).toEqual({
      folders: ['local', 'src'],
      includeGlob: '**/*.ts',
      excludeGlob: '**/dist/**',
      useGitIgnore: true,
      maxFileSizeKB: 128,
    });
    vscode.window.activeTextEditor = { document: { uri: { fsPath: '/repo/core/src/file.ts' } } } as never;
    vscode.workspace.getWorkspaceFolder = () => workspaceFolders[1] as never;
    expect(getDefaultScopeWorkspace(workspaceFolders as never)).toBe(workspaceFolders[1]);
    vscode.workspace.getWorkspaceFolder = () => undefined;
    expect(getDefaultScopeWorkspace(workspaceFolders as never)).toBe(workspaceFolders[0]);
    vscode.window.activeTextEditor = undefined;
    expect(getDefaultScopeWorkspace(workspaceFolders as never)).toBe(workspaceFolders[0]);
  });

  it('returns undefined when a scoped workspace cannot be mapped', async () => {
    vscode.workspace.workspaceFolders = workspaceFolders as never;
    vscode.workspace.getWorkspaceFolder = () => workspaceFolders[1] as never;
    vscode.window.activeTextEditor = { document: { uri: { fsPath: '/repo/core/src/file.ts' } } } as never;

    const { getDefaultScopeWorkspace, scopeForWorkspace } = await import('../folders');

    expect(
      scopeForWorkspace(
        {
          folders: ['/outside/project'],
          includeGlob: '**/*.ts',
          excludeGlob: '**/dist/**',
          useGitIgnore: true,
          maxFileSizeKB: 128,
        },
        workspaceFolders[0] as never,
      ),
    ).toBeUndefined();
    expect(getDefaultScopeWorkspace(workspaceFolders as never)).toBe(workspaceFolders[1]);
  });

  it('normalizes a workspace root folder to "."', async () => {
    vscode.workspace.workspaceFolders = workspaceFolders as never;
    vscode.workspace.getWorkspaceFolder = () => workspaceFolders[0] as never;

    const { scopeForWorkspace } = await import('../folders');

    expect(
      scopeForWorkspace(
        {
          folders: ['/repo/app'],
          includeGlob: '**/*.ts',
          excludeGlob: '**/dist/**',
          useGitIgnore: true,
          maxFileSizeKB: 128,
        },
        workspaceFolders[0] as never,
      ),
    ).toEqual({
      folders: ['.'],
      includeGlob: '**/*.ts',
      excludeGlob: '**/dist/**',
      useGitIgnore: true,
      maxFileSizeKB: 128,
    });
  });
});
