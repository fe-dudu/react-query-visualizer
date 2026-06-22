import { describe, expect, it, vi } from 'vitest';

import * as vscode from '../../../testing/vscode';

vi.mock('vscode', async () => await import('../../../testing/vscode'));

describe('core/workspace/scope', () => {
  it('formats scopes and prompts for folder selection', async () => {
    const showOpenDialog = async () => [{ fsPath: '/repo/src' }, { fsPath: '/repo/packages/core' }];
    let inputCallCount = 0;
    const showInputBox = async () => {
      inputCallCount += 1;
      return inputCallCount === 1
        ? '**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'
        : '**/{.git,.idea,.vscode,.cache,.next,.nuxt,.svelte-kit,.turbo,.expo,.expo-shared,.omc,.omx,.pnpm-store,.yarn,.parcel-cache,node_modules,dist,build,coverage,out,release,android,ios,Pods,bin,obj,temp,tmp,storybook-static}/**';
    };
    vscode.window.showOpenDialog = showOpenDialog;
    vscode.window.showInputBox = showInputBox;
    vscode.workspace.getConfiguration = () => ({
      get: <T>(_key: string, fallback: T): T => fallback,
      update: async () => undefined,
    });

    const { promptScope, scopeToLabel } = await import('../scope');

    expect(
      scopeToLabel({
        folders: ['src', 'packages/core'],
        includeGlob: '**/*.ts',
        excludeGlob: '**/dist/**',
        useGitIgnore: true,
        maxFileSizeKB: 128,
      }),
    ).toBe('Folders: src, packages/core | Include: **/*.ts | Exclude: **/dist/**');

    const scope = await promptScope({
      uri: { fsPath: '/repo' },
    } as never);

    expect(scope).toEqual({
      folders: ['src', 'packages/core'],
      includeGlob: '**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}',
      excludeGlob:
        '**/{.git,.idea,.vscode,.cache,.next,.nuxt,.svelte-kit,.turbo,.expo,.expo-shared,.omc,.omx,.pnpm-store,.yarn,.parcel-cache,node_modules,dist,build,coverage,out,release,android,ios,Pods,bin,obj,temp,tmp,storybook-static}/**',
      useGitIgnore: true,
      maxFileSizeKB: 512,
    });
  });

  it('returns undefined when the folder or glob prompts are cancelled', async () => {
    const { promptScope } = await import('../scope');
    const workspaceFolder = { uri: { fsPath: '/repo' } } as never;

    vscode.window.showOpenDialog = async () => undefined;
    expect(await promptScope(workspaceFolder)).toBeUndefined();

    vscode.window.showOpenDialog = async () => [{ fsPath: '/repo' }];
    vscode.window.showInputBox = async () => undefined;
    expect(await promptScope(workspaceFolder)).toBeUndefined();

    let inputCallCount = 0;
    vscode.window.showInputBox = async () => {
      inputCallCount += 1;
      return inputCallCount === 1 ? '**/*.ts' : undefined;
    };
    expect(await promptScope(workspaceFolder)).toBeUndefined();
  });

  it('keeps root and external folder labels stable', async () => {
    const { promptScope, scopeToLabel } = await import('../scope');
    const workspaceFolder = { uri: { fsPath: '/repo' } } as never;
    let inputCallCount = 0;

    vscode.window.showOpenDialog = async () => [{ fsPath: '/repo' }, { fsPath: '/outside/shared' }];
    vscode.window.showInputBox = async () => {
      inputCallCount += 1;
      return inputCallCount === 1 ? '**/*.tsx' : '**/dist/**';
    };

    expect(await promptScope(workspaceFolder)).toMatchObject({
      folders: ['.', '/outside/shared'],
      includeGlob: '**/*.tsx',
      excludeGlob: '**/dist/**',
    });
    expect(
      scopeToLabel({
        folders: [],
        includeGlob: '**/*.ts',
        excludeGlob: '**/dist/**',
        useGitIgnore: true,
        maxFileSizeKB: 128,
      }),
    ).toBe('Folders: . | Include: **/*.ts | Exclude: **/dist/**');
  });

  it('uses configured glob values as prompt defaults', async () => {
    const { promptScope } = await import('../scope');
    const workspaceFolder = { uri: { fsPath: '/repo' } } as never;
    const seenValues: unknown[] = [];
    let inputCallCount = 0;

    vscode.workspace.getConfiguration = () => ({
      get: <T>(key: string, fallback: T): T => {
        if (key === 'scope.include') {
          return 'src/**/*.ts' as T;
        }
        if (key === 'scope.exclude') {
          return 'vendor/**' as T;
        }
        return fallback;
      },
      update: async () => undefined,
    });
    vscode.window.showOpenDialog = async () => [{ fsPath: '/repo/src' }];
    vscode.window.showInputBox = async (options) => {
      const value = (options as { value?: string } | undefined)?.value;
      seenValues.push(value);
      inputCallCount += 1;
      return inputCallCount === 1 ? 'src/**/*.ts' : 'vendor/**';
    };

    await promptScope(workspaceFolder);

    expect(seenValues).toEqual(['src/**/*.ts', 'vendor/**']);
  });

  it('falls back to default glob values when configured values are empty', async () => {
    const { promptScope } = await import('../scope');
    const workspaceFolder = { uri: { fsPath: '/repo' } } as never;
    const seenValues: unknown[] = [];
    let inputCallCount = 0;

    vscode.workspace.getConfiguration = () => ({
      get: <T>(key: string, fallback: T): T => {
        if (key === 'scope.include' || key === 'scope.exclude') {
          return '' as T;
        }
        return fallback;
      },
      update: async () => undefined,
    });
    vscode.window.showOpenDialog = async () => [{ fsPath: '/repo/src' }];
    vscode.window.showInputBox = async (options) => {
      const value = (options as { value?: string } | undefined)?.value;
      seenValues.push(value);
      inputCallCount += 1;
      return inputCallCount === 1 ? String(value) : String(value);
    };

    await promptScope(workspaceFolder);

    expect(seenValues[0]).toContain('*.{ts,tsx');
    expect(seenValues[1]).toContain('node_modules');
  });
});
