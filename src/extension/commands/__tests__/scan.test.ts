import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGraph, createQueryRecord } from '../../../testing/fixtures';
import * as vscode from '../../../testing/vscode';

vi.mock('vscode', async () => await import('../../../testing/vscode'));

const runStaticAnalysisMock = vi.hoisted(() => vi.fn());

vi.mock('../../../core/graph/buildGraph', () => ({
  buildGraph: vi.fn(),
}));

vi.mock('../../../core/workspace/config', () => ({
  getLayoutConfig: vi.fn(() => ({
    direction: 'LR',
    engine: 'dagre',
    verticalSpacing: 30,
    horizontalSpacing: 500,
  })),
  persistScanScope: vi.fn(),
}));

vi.mock('../../../core/workspace/scope', () => ({
  scopeToLabel: vi.fn(() => 'Scope'),
}));

vi.mock('../../views/graphPanel', () => ({
  GraphPanel: {
    createOrShow: vi.fn(() => ({
      update: vi.fn(),
    })),
  },
}));

vi.mock('../../workspace/folders', () => ({
  getWorkspaceFolders: vi.fn(),
  scopeForWorkspace: vi.fn((scope: unknown) => scope),
}));

afterEach(() => {
  runStaticAnalysisMock.mockReset();
  vi.clearAllMocks();
});

describe('extension/commands/scan', () => {
  it('runs a scan and formats scanned file paths', async () => {
    const { buildGraph } = await import('../../../core/graph/buildGraph');
    const { getWorkspaceFolders, scopeForWorkspace } = await import('../../workspace/folders');

    vi.mocked(scopeForWorkspace).mockImplementation((scope: unknown) => scope as never);
    vi.mocked(getWorkspaceFolders).mockReturnValue([
      { name: 'web', uri: { fsPath: '/workspace/web' } },
      { name: 'api', uri: { fsPath: '/workspace/api' } },
    ] as never);
    runStaticAnalysisMock
      .mockResolvedValueOnce({
        records: [],
        scannedFiles: ['/workspace/web/src/query.ts'],
        filesScanned: 1,
        parseErrors: [],
      } as never)
      .mockResolvedValueOnce({
        records: [],
        scannedFiles: ['/workspace/api/src/query.ts'],
        filesScanned: 1,
        parseErrors: [],
      } as never);
    vi.mocked(buildGraph).mockReturnValue(
      createGraph({
        nodes: [],
        edges: [],
      }) as never,
    );

    const { runScan, scanAndPublish } = await import('../scan');
    const result = await runScan(
      [
        { name: 'web', uri: { fsPath: '/workspace/web' } },
        { name: 'api', uri: { fsPath: '/workspace/api' } },
      ] as never,
      { folders: [], includeGlob: '**/*.ts', excludeGlob: '**/*.test.ts', useGitIgnore: true, maxFileSizeKB: 512 },
      runStaticAnalysisMock,
    );

    expect(result.scannedWorkspaces).toEqual(['web', 'api']);
    expect(result.payload.scannedFiles.map((file) => file.path)).toEqual(['api/src/query.ts', 'web/src/query.ts']);
    expect(result.payload.scopeLabel).toBe('Scope | Workspaces: web, api');

    runStaticAnalysisMock
      .mockResolvedValueOnce({
        records: [],
        scannedFiles: ['/workspace/web/src/query.ts'],
        filesScanned: 1,
        parseErrors: [],
      } as never)
      .mockResolvedValueOnce({
        records: [],
        scannedFiles: ['/workspace/api/src/query.ts'],
        filesScanned: 1,
        parseErrors: [],
      } as never);
    const progressReports: unknown[] = [];
    const infoMessages: string[] = [];
    vi.spyOn(vscode.window, 'withProgress').mockImplementation(async (_options, task) =>
      task({ report: (value: unknown) => progressReports.push(value) }),
    );
    vi.spyOn(vscode.window, 'showInformationMessage').mockImplementation(async (...messageArgs: unknown[]) => {
      const [message] = messageArgs;
      if (typeof message === 'string') {
        infoMessages.push(message);
      }
      return undefined;
    });

    await scanAndPublish({
      context: { extensionUri: vscode.Uri.file('/extension') } as never,
      scope: {
        folders: [],
        includeGlob: '**/*.ts',
        excludeGlob: '**/*.test.ts',
        useGitIgnore: true,
        maxFileSizeKB: 512,
      },
      persistScopeFlag: false,
      onPayloadUpdated: vi.fn(),
      runStaticAnalysis: runStaticAnalysisMock,
    });

    expect(progressReports).toEqual([{ message: 'Collecting source files...' }, { message: 'Building graph...' }]);
    expect(infoMessages[0]).toContain('scan complete');
  });

  it('warns when no workspace folders are open and persists a scoped scan with parse errors', async () => {
    const { buildGraph } = await import('../../../core/graph/buildGraph');
    const { persistScanScope } = await import('../../../core/workspace/config');
    const { getWorkspaceFolders, scopeForWorkspace } = await import('../../workspace/folders');

    vi.mocked(scopeForWorkspace).mockImplementation((scope: unknown) => scope as never);
    vi.mocked(getWorkspaceFolders).mockReturnValue([] as never);

    const warningMessages: string[] = [];
    const infoMessages: string[] = [];
    vi.spyOn(vscode.window, 'showWarningMessage').mockImplementation(async (...messageArgs: unknown[]) => {
      const [message] = messageArgs;
      if (typeof message === 'string') {
        warningMessages.push(message);
      }
      return undefined;
    });
    vi.spyOn(vscode.window, 'showInformationMessage').mockImplementation(async (...messageArgs: unknown[]) => {
      const [message] = messageArgs;
      if (typeof message === 'string') {
        infoMessages.push(message);
      }
      return undefined;
    });

    const { scanAndPublish } = await import('../scan');

    await scanAndPublish({
      context: { extensionUri: vscode.Uri.file('/extension') } as never,
      scope: {
        folders: ['src'],
        includeGlob: '**/*.ts',
        excludeGlob: '**/*.test.ts',
        useGitIgnore: true,
        maxFileSizeKB: 512,
      },
      persistScopeFlag: true,
      onPayloadUpdated: vi.fn(),
      runStaticAnalysis: runStaticAnalysisMock,
    });

    expect(warningMessages[0]).toContain('Open a workspace folder first');
    expect(infoMessages).toEqual([]);
    expect(persistScanScope).not.toHaveBeenCalled();
    expect(buildGraph).not.toHaveBeenCalled();

    vi.mocked(getWorkspaceFolders).mockReturnValue([{ name: 'web', uri: { fsPath: '/workspace/web' } }] as never);
    vi.mocked(buildGraph).mockReturnValue(
      createGraph({
        nodes: [],
        edges: [],
        summary: { files: 1, actions: 0, queryKeys: 0, parseErrors: 2 },
        parseErrors: [
          { file: 'src/a.ts', message: 'first' },
          { file: 'src/b.ts', message: 'second' },
        ],
      }) as never,
    );
    vi.mocked(persistScanScope).mockResolvedValue(undefined as never);
    vi.spyOn(vscode.window, 'withProgress').mockImplementation(async (_options, task) =>
      task({ report: () => undefined }),
    );

    vi.mocked(vscode.window.showWarningMessage).mockClear();
    vi.mocked(vscode.window.showInformationMessage).mockClear();

    runStaticAnalysisMock.mockResolvedValue({
      records: [],
      scannedFiles: ['/workspace/web/src/query.ts'],
      filesScanned: 1,
      parseErrors: [],
    } as never);

    await scanAndPublish({
      context: { extensionUri: vscode.Uri.file('/extension') } as never,
      scope: {
        folders: ['src'],
        includeGlob: '**/*.ts',
        excludeGlob: '**/*.test.ts',
        useGitIgnore: true,
        maxFileSizeKB: 512,
      },
      persistScopeFlag: true,
      onPayloadUpdated: vi.fn(),
      runStaticAnalysis: runStaticAnalysisMock,
    });

    expect(persistScanScope).toHaveBeenCalledWith({
      folders: ['src'],
      includeGlob: '**/*.ts',
      excludeGlob: '**/*.test.ts',
      useGitIgnore: true,
      maxFileSizeKB: 512,
    });
    expect(infoMessages[0]).toContain('scan complete');
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });

  it('dedupes scanned files and keeps out-of-root paths absolute', async () => {
    const { buildGraph } = await import('../../../core/graph/buildGraph');
    const { getWorkspaceFolders, scopeForWorkspace } = await import('../../workspace/folders');

    vi.mocked(scopeForWorkspace).mockImplementation((scope: unknown) => scope as never);
    vi.mocked(getWorkspaceFolders).mockReturnValue([{ name: 'web', uri: { fsPath: '/workspace/web' } }] as never);
    runStaticAnalysisMock.mockResolvedValueOnce({
      records: [],
      scannedFiles: ['/workspace/web', '/workspace/web', '/outside/shared.ts'],
      filesScanned: 3,
      parseErrors: [],
    } as never);
    vi.mocked(buildGraph).mockReturnValue(
      createGraph({
        nodes: [],
        edges: [],
      }) as never,
    );

    const { runScan } = await import('../scan');
    const result = await runScan(
      [{ name: 'web', uri: { fsPath: '/workspace/web' } }] as never,
      { folders: [], includeGlob: '**/*.ts', excludeGlob: '**/*.test.ts', useGitIgnore: true, maxFileSizeKB: 512 },
      runStaticAnalysisMock,
    );

    expect(result.scannedWorkspaces).toEqual(['web']);
    expect(result.payload.scannedFiles.map((file) => file.path)).toEqual(['web', '/outside/shared.ts']);
    expect(result.payload.scannedFiles.map((file) => file.workspace)).toEqual(['web', 'web']);
    expect(result.payload.scannedFiles.map((file) => file.depth)).toEqual([0, 1]);
  });

  it('dedupes merged analysis records and errors when scoped targets are empty', async () => {
    const { buildGraph } = await import('../../../core/graph/buildGraph');
    const { scopeForWorkspace } = await import('../../workspace/folders');
    const { runScan } = await import('../scan');

    const duplicateRecord = createQueryRecord({
      file: '/workspace/web/src/query.ts',
      loc: { line: 1, column: 2 },
      relation: 'declares',
      operation: 'useQuery',
      queryKey: {
        id: 'todos',
        display: '[todos]',
        segments: ['todos'],
        matchMode: 'exact',
        resolution: 'static',
        source: 'literal',
      },
      clientScopeId: 'client',
      executionScopeId: 'execution',
      suiteScopeId: 'suite',
      declaresDirectly: true,
    });
    const plainRecord = createQueryRecord({
      file: '/workspace/web/src/plain.ts',
      loc: { line: 3, column: 4 },
      relation: 'invalidates',
      operation: 'invalidateQueries',
      queryKey: {
        id: 'users',
        display: '[users]',
        segments: ['users'],
        matchMode: 'exact',
        resolution: 'static',
        source: 'literal',
      },
    });
    vi.mocked(scopeForWorkspace).mockImplementation((scope: unknown) => scope as never);
    runStaticAnalysisMock
      .mockResolvedValueOnce({
        records: [duplicateRecord, plainRecord],
        scannedFiles: ['/workspace/web/src/query.ts'],
        filesScanned: 1,
        parseErrors: [],
      } as never)
      .mockResolvedValueOnce({
        records: [duplicateRecord],
        scannedFiles: ['/workspace/api/src/query.ts'],
        filesScanned: 1,
        parseErrors: [],
      } as never);
    vi.mocked(buildGraph).mockReturnValue(createGraph({ nodes: [], edges: [] }) as never);

    await runScan(
      [
        { name: 'web', uri: { fsPath: '/workspace/web' } },
        { name: 'api', uri: { fsPath: '/workspace/api' } },
      ] as never,
      { folders: [], includeGlob: '**/*.ts', excludeGlob: '**/*.test.ts', useGitIgnore: true, maxFileSizeKB: 512 },
      runStaticAnalysisMock,
    );

    const lastBuildGraphCall = vi.mocked(buildGraph).mock.calls[vi.mocked(buildGraph).mock.calls.length - 1];
    expect(lastBuildGraphCall?.[1].records).toHaveLength(2);

    vi.mocked(scopeForWorkspace).mockReturnValue(null as never);
    await expect(
      runScan(
        [{ name: 'web', uri: { fsPath: '/workspace/web' } }] as never,
        {
          folders: ['outside'],
          includeGlob: '**/*.ts',
          excludeGlob: '**/*.test.ts',
          useGitIgnore: true,
          maxFileSizeKB: 512,
        },
        runStaticAnalysisMock,
      ),
    ).rejects.toThrow('Selected folders are outside all opened workspaces.');
  });
});
