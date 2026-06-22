import { describe, expect, it, vi } from 'vitest';

import { createGraph, createScannedFile } from '../../testing/fixtures';
import * as vscode from '../../testing/vscode';

vi.mock('vscode', async () => await import('../../testing/vscode'));

describe('extension/index', () => {
  it('registers commands and exercises activation branches', async () => {
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    vi.spyOn(vscode.commands, 'registerCommand').mockImplementation(
      (name: string, callback: (...args: unknown[]) => unknown) => {
        registered.set(name, callback);
        return { dispose: () => undefined };
      },
    );

    let collapseHandler: ((event: { element: { children: unknown[] } }) => void) | undefined;
    const treeViewReveal = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(vscode.window, 'createTreeView').mockReturnValue({
      dispose: () => undefined,
      reveal: treeViewReveal,
      onDidCollapseElement: (handler: typeof collapseHandler) => {
        collapseHandler = handler;
        return { dispose: () => undefined };
      },
    } as never);

    const warningMessages: string[] = [];
    vi.spyOn(vscode.window, 'showWarningMessage').mockImplementation(async (...messageArgs: unknown[]) => {
      const [message] = messageArgs;
      if (typeof message === 'string') {
        warningMessages.push(message);
      }
      return undefined;
    });
    vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

    const updateFromPayloadSpy = vi.fn();
    vi.doMock('../views/activityView', () => ({
      RqvActivityViewProvider: class {
        updateFromPayload = updateFromPayloadSpy;
      },
    }));

    const panelUpdate = vi.fn();
    const createOrShow = vi.fn(() => ({ update: panelUpdate }));
    vi.doMock('../views/graphPanel', () => ({
      GraphPanel: {
        createOrShow,
      },
    }));

    const revealInCode = vi.fn();
    vi.doMock('../commands/reveal', () => ({
      revealInCode,
    }));

    const runStaticAnalysis = vi.fn().mockResolvedValue({
      records: [],
      scannedFiles: [],
      parseErrors: [],
      filesScanned: 0,
    });
    vi.doMock('../../core/analysis/analyzer', () => ({
      runStaticAnalysis,
    }));

    const payload = {
      graph: createGraph({
        nodes: [],
        edges: [],
      }),
      scannedFiles: [createScannedFile({ path: 'web/src/query.ts', workspace: 'web', depth: 1 })],
      scopeLabel: 'workspace',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 24,
        horizontalSpacing: 480,
      },
    };
    const scanAndPublish = vi.fn(
      async ({
        onPayloadUpdated,
        persistScopeFlag,
      }: {
        onPayloadUpdated: (p: unknown) => void;
        persistScopeFlag: boolean;
      }) => {
        if (!persistScopeFlag) {
          await runStaticAnalysis('/workspace', {
            folders: ['.'],
            includeGlob: '**/*.ts',
            excludeGlob: '',
            useGitIgnore: true,
            maxFileSizeKB: 512,
          });
        }
        onPayloadUpdated(persistScopeFlag ? { ...payload, scopeLabel: 'scoped' } : payload);
      },
    );
    vi.doMock('../commands/scan', () => ({
      scanAndPublish,
    }));

    const workspaceFolders = [{ uri: vscode.Uri.file('/repo') }];
    const getWorkspaceFolders = vi.fn(() => workspaceFolders);
    vi.doMock('../workspace/folders', () => ({
      getDefaultScopeWorkspace: () => workspaceFolders[0],
      getWorkspaceFolders,
    }));

    const layoutConfig = {
      direction: 'LR',
      engine: 'dagre',
      verticalSpacing: 20,
      horizontalSpacing: 420,
    };
    const getLayoutConfig = vi.fn(() => layoutConfig);
    const getScanScopeConfig = vi.fn(() => ({
      folders: ['.'],
      includeGlob: '**/*.ts',
      excludeGlob: '**/dist/**',
      useGitIgnore: true,
      maxFileSizeKB: 512,
    }));
    vi.doMock('../../core/workspace/config', () => ({
      getLayoutConfig,
      getScanScopeConfig,
    }));

    const promptScope = vi.fn();
    vi.doMock('../../core/workspace/scope', () => ({
      promptScope,
    }));

    const { activate } = await import('../index');
    activate({
      extensionUri: vscode.Uri.file('/workspace'),
      subscriptions: [],
    } as never);

    expect([...registered.keys()]).toEqual([
      'rqv.focusActivity',
      'rqv.openGraphPanel',
      'rqv.scanNow',
      'rqv.scanWithScope',
      'rqv.revealInCode',
    ]);

    collapseHandler?.({ element: { children: [] } });
    collapseHandler?.({ element: { children: [{}] } });
    treeViewReveal.mockRejectedValueOnce(new Error('reveal failed'));
    collapseHandler?.({ element: { children: [{}] } });
    expect(treeViewReveal).toHaveBeenCalledTimes(2);

    await registered.get('rqv.focusActivity')?.();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.view.extension.rqvContainer');

    await registered.get('rqv.openGraphPanel')?.();
    expect(createOrShow).toHaveBeenCalledWith(vscode.Uri.file('/workspace'), layoutConfig);
    expect(updateFromPayloadSpy).not.toHaveBeenCalled();
    expect(panelUpdate).not.toHaveBeenCalled();
    createOrShow.mockClear();

    await registered.get('rqv.scanNow')?.();
    expect(scanAndPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ extensionUri: vscode.Uri.file('/workspace') }),
        scope: getScanScopeConfig.mock.results[0]?.value,
        persistScopeFlag: false,
        activityViewProvider: expect.any(Object),
        onPayloadUpdated: expect.any(Function),
      }),
    );
    expect(runStaticAnalysis).toHaveBeenCalledTimes(1);

    await registered.get('rqv.openGraphPanel')?.();
    expect(createOrShow).toHaveBeenCalledWith(vscode.Uri.file('/workspace'), layoutConfig);
    expect(updateFromPayloadSpy).toHaveBeenCalledWith(payload);
    expect(panelUpdate).toHaveBeenCalledWith(payload);

    getWorkspaceFolders.mockReturnValue([]);
    await registered.get('rqv.scanWithScope')?.();
    expect(warningMessages).toEqual(['React Query Visualizer: Open a workspace folder first.']);

    getWorkspaceFolders.mockReturnValue(workspaceFolders);
    promptScope.mockResolvedValueOnce(undefined);
    await registered.get('rqv.scanWithScope')?.();
    expect(scanAndPublish).toHaveBeenCalledTimes(1);

    promptScope.mockResolvedValueOnce({
      folders: ['src'],
      includeGlob: '**/*.ts',
      excludeGlob: '**/dist/**',
      useGitIgnore: true,
      maxFileSizeKB: 256,
    });
    await registered.get('rqv.scanWithScope')?.();
    expect(scanAndPublish).toHaveBeenCalledTimes(2);
    expect(scanAndPublish.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        persistScopeFlag: true,
        scope: {
          folders: ['src'],
          includeGlob: '**/*.ts',
          excludeGlob: '**/dist/**',
          useGitIgnore: true,
          maxFileSizeKB: 256,
        },
      }),
    );

    await registered.get('rqv.revealInCode')?.({ file: 'src/file.ts', line: 4, column: 2 });
    expect(revealInCode).toHaveBeenCalledWith({ file: 'src/file.ts', line: 4, column: 2 });
  });
});
