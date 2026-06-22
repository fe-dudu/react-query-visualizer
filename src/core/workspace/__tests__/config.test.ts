import { describe, expect, it, vi } from 'vitest';

import * as vscode from '../../../testing/vscode';

vi.mock('vscode', async () => await import('../../../testing/vscode'));

describe('core/workspace/config', () => {
  it('reads and persists workspace settings', async () => {
    const settings = new Map<string, unknown>([
      ['scope.folders', ['src']],
      ['scope.include', '**/*.ts'],
      ['scope.exclude', '**/dist/**'],
      ['scan.useGitIgnore', false],
      ['scan.maxFileSizeKB', 42],
      ['graph.verticalSpacing', 64],
      ['graph.horizontalSpacing', 900],
      ['graph.nodeSpacing', 12],
    ]);
    const updates: Array<[string, unknown, unknown]> = [];
    vscode.workspace.getConfiguration = () => ({
      get: <T>(key: string, fallback: T): T => (settings.has(key) ? (settings.get(key) as T) : fallback),
      update: async (key: string, value: unknown, target: unknown) => {
        updates.push([key, value, target]);
      },
    });

    const { getLayoutConfig, getScanScopeConfig, persistScanScope } = await import('../config');

    expect(getScanScopeConfig()).toEqual({
      folders: ['src'],
      includeGlob: '**/*.ts',
      excludeGlob: '**/dist/**',
      useGitIgnore: false,
      maxFileSizeKB: 42,
    });

    expect(getLayoutConfig()).toEqual({
      direction: 'LR',
      engine: 'dagre',
      verticalSpacing: 64,
      horizontalSpacing: 900,
    });

    await persistScanScope({
      folders: ['app'],
      includeGlob: '**/*.tsx',
      excludeGlob: '**/build/**',
      useGitIgnore: true,
      maxFileSizeKB: 64,
    });

    expect(updates).toEqual([
      ['scope.folders', ['app'], 'workspace'],
      ['scope.include', '**/*.tsx', 'workspace'],
      ['scope.exclude', '**/build/**', 'workspace'],
      ['scan.useGitIgnore', true, 'workspace'],
      ['scan.maxFileSizeKB', 64, 'workspace'],
    ]);
  });
});
