import { afterEach, describe, expect, it, vi } from 'vitest';

import * as vscode from '../../../testing/vscode';

vi.mock('vscode', async () => await import('../../../testing/vscode'));

afterEach(() => {
  vi.clearAllMocks();
});

describe('extension/views/graphPanel', () => {
  it('renders the panel html and responds to messages', async () => {
    const postMessage = vi.fn();
    let messageHandler: ((message: unknown) => void) | undefined;
    let disposeHandler: (() => void) | undefined;
    let colorThemeHandler: (() => void) | undefined;
    const reveal = vi.fn();
    vscode.window.activeColorTheme = { kind: 1 };

    vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue({
      webview: {
        html: '',
        cspSource: 'vscode-resource:',
        asWebviewUri: (uri: { toString: () => string }) => uri.toString(),
        postMessage,
        onDidReceiveMessage: (handler: (message: unknown) => void) => {
          messageHandler = handler;
          return { dispose: () => undefined };
        },
      },
      reveal,
      onDidDispose: (handler: () => void) => {
        disposeHandler = handler;
        return { dispose: () => undefined };
      },
    } as never);

    vi.spyOn(vscode.window, 'onDidChangeActiveColorTheme').mockImplementation((handler: () => void) => {
      colorThemeHandler = handler;
      return { dispose: () => undefined };
    });
    vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

    const { GraphPanel } = await import('../graphPanel');
    const panel = GraphPanel.createOrShow(vscode.Uri.file('/extension'), {
      direction: 'LR',
      engine: 'dagre',
      verticalSpacing: 30,
      horizontalSpacing: 500,
    });

    expect(reveal).not.toHaveBeenCalled();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalled();

    messageHandler?.({ type: 'ready' });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'theme',
      themeKind: vscode.window.activeColorTheme?.kind,
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'graphData',
      payload: expect.objectContaining({
        scopeLabel: 'No scan has run yet',
      }),
    });

    panel.update({
      graph: { nodes: [], edges: [], summary: { files: 1, actions: 0, queryKeys: 0, parseErrors: 0 }, parseErrors: [] },
      scannedFiles: [],
      scopeLabel: 'payload',
      layout: { direction: 'LR', engine: 'dagre', verticalSpacing: 30, horizontalSpacing: 500 },
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'graphData',
      payload: expect.objectContaining({ scopeLabel: 'payload' }),
    });

    messageHandler?.({ type: 'reveal', file: '/tmp/file.ts', line: 2, column: 3 });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('rqv.revealInCode', {
      file: '/tmp/file.ts',
      line: 2,
      column: 3,
    });

    colorThemeHandler?.();
    disposeHandler?.();
  });

  it('reuses the existing panel instance and clears current state on dispose', async () => {
    const postMessage = vi.fn();
    let disposeHandler: (() => void) | undefined;
    const reveal = vi.fn();
    vscode.window.activeColorTheme = { kind: 1 };

    vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue({
      webview: {
        html: '',
        cspSource: 'vscode-resource:',
        asWebviewUri: (uri: { toString: () => string }) => uri.toString(),
        postMessage,
        onDidReceiveMessage: () => ({ dispose: () => undefined }),
      },
      reveal,
      onDidDispose: (handler: () => void) => {
        disposeHandler = handler;
        return { dispose: () => undefined };
      },
    } as never);

    const { GraphPanel } = await import('../graphPanel');
    const first = GraphPanel.createOrShow(vscode.Uri.file('/extension'), {
      direction: 'LR',
      engine: 'dagre',
      verticalSpacing: 30,
      horizontalSpacing: 500,
    });
    const second = GraphPanel.createOrShow(vscode.Uri.file('/extension'), {
      direction: 'LR',
      engine: 'dagre',
      verticalSpacing: 30,
      horizontalSpacing: 500,
    });

    expect(second).toBe(first);
    expect(reveal).toHaveBeenCalledWith(vscode.ViewColumn.One);
    expect(GraphPanel.currentPanel).toBe(first);

    disposeHandler?.();
    expect(GraphPanel.currentPanel).toBeUndefined();
  });

  it('queues updates until ready and ignores invalid messages', async () => {
    const postMessage = vi.fn();
    let messageHandler: ((message: unknown) => void) | undefined;
    let colorThemeHandler: (() => void) | undefined;
    const reveal = vi.fn();
    vscode.window.activeColorTheme = { kind: 2 };

    vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue({
      webview: {
        html: '',
        cspSource: 'vscode-resource:',
        asWebviewUri: (uri: { toString: () => string }) => uri.toString(),
        postMessage,
        onDidReceiveMessage: (handler: (message: unknown) => void) => {
          messageHandler = handler;
          return { dispose: () => undefined };
        },
      },
      reveal,
      onDidDispose: () => ({ dispose: () => undefined }),
    } as never);
    vi.spyOn(vscode.window, 'onDidChangeActiveColorTheme').mockImplementation((handler: () => void) => {
      colorThemeHandler = handler;
      return { dispose: () => undefined };
    });
    vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);

    const { GraphPanel } = await import('../graphPanel');
    const panel = GraphPanel.createOrShow(vscode.Uri.file('/extension'), {
      direction: 'LR',
      engine: 'dagre',
      verticalSpacing: 30,
      horizontalSpacing: 500,
    });

    panel.update({
      graph: { nodes: [], edges: [], summary: { files: 2, actions: 0, queryKeys: 0, parseErrors: 0 }, parseErrors: [] },
      scannedFiles: [],
      scopeLabel: 'queued',
      layout: { direction: 'LR', engine: 'dagre', verticalSpacing: 30, horizontalSpacing: 500 },
    });
    expect(postMessage).not.toHaveBeenCalled();
    colorThemeHandler?.();
    expect(postMessage).not.toHaveBeenCalled();

    messageHandler?.(undefined);
    messageHandler?.('ready');
    messageHandler?.({ type: 'reveal' });
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();

    messageHandler?.({ type: 'ready' });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'graphData',
      payload: expect.objectContaining({ scopeLabel: 'queued' }),
    });
  });

  it('does not clear current when dispose fires for a stale (non-current) panel instance', async () => {
    const disposeHandlers: Array<() => void> = [];
    vscode.window.activeColorTheme = { kind: 1 };

    vi.spyOn(vscode.window, 'createWebviewPanel').mockImplementation(
      () =>
        ({
          webview: {
            html: '',
            cspSource: 'vscode-resource:',
            asWebviewUri: (uri: { toString: () => string }) => uri.toString(),
            postMessage: vi.fn(),
            onDidReceiveMessage: () => ({ dispose: () => undefined }),
          },
          reveal: vi.fn(),
          onDidDispose: (handler: () => void) => {
            disposeHandlers.push(handler);
            return { dispose: () => undefined };
          },
        }) as never,
    );

    vi.spyOn(vscode.window, 'onDidChangeActiveColorTheme').mockImplementation(() => ({
      dispose: () => undefined,
    }));

    const { GraphPanel } = await import('../graphPanel');

    // Force-clear any static state left by previous tests that skipped cleanup.
    (GraphPanel as unknown as { current: undefined }).current = undefined;

    // Create panel1 — current is set to panel1, disposeHandlers[0] is panel1's handler.
    const panel1 = GraphPanel.createOrShow(vscode.Uri.file('/extension'), {
      direction: 'LR',
      engine: 'dagre',
      verticalSpacing: 30,
      horizontalSpacing: 500,
    });
    expect(GraphPanel.currentPanel).toBe(panel1);

    // Dispose panel1 → current becomes undefined.
    disposeHandlers[0]?.();
    expect(GraphPanel.currentPanel).toBeUndefined();

    // Create panel2 — current is now panel2, disposeHandlers[1] is panel2's handler.
    const panel2 = GraphPanel.createOrShow(vscode.Uri.file('/extension'), {
      direction: 'LR',
      engine: 'dagre',
      verticalSpacing: 30,
      horizontalSpacing: 500,
    });
    expect(GraphPanel.currentPanel).toBe(panel2);

    // Fire panel1's stale dispose: GraphPanel.current !== panel1, so current should stay as panel2.
    disposeHandlers[0]?.();
    expect(GraphPanel.currentPanel).toBe(panel2);

    // Clean up: dispose panel2 properly.
    disposeHandlers[1]?.();
    expect(GraphPanel.currentPanel).toBeUndefined();
  });

  it('skips postGraph when latestPayload is cleared before ready fires', async () => {
    const postMessage = vi.fn();
    let messageHandler: ((message: unknown) => void) | undefined;
    vscode.window.activeColorTheme = { kind: 1 };

    vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue({
      webview: {
        html: '',
        cspSource: 'vscode-resource:',
        asWebviewUri: (uri: { toString: () => string }) => uri.toString(),
        postMessage,
        onDidReceiveMessage: (handler: (message: unknown) => void) => {
          messageHandler = handler;
          return { dispose: () => undefined };
        },
      },
      reveal: vi.fn(),
      onDidDispose: () => ({ dispose: () => undefined }),
    } as never);

    vi.spyOn(vscode.window, 'onDidChangeActiveColorTheme').mockImplementation(() => ({
      dispose: () => undefined,
    }));

    const { GraphPanel } = await import('../graphPanel');

    // Force-clear static state.
    (GraphPanel as unknown as { current: undefined }).current = undefined;

    const panel = GraphPanel.createOrShow(vscode.Uri.file('/extension'), {
      direction: 'LR',
      engine: 'dagre',
      verticalSpacing: 30,
      horizontalSpacing: 500,
    });

    // Clear latestPayload via private field access before the ready message fires.
    (panel as unknown as { latestPayload: undefined }).latestPayload = undefined;

    // Send ready — postTheme fires, but postGraph should NOT fire because latestPayload is now undefined.
    messageHandler?.({ type: 'ready' });

    const graphDataCalls = postMessage.mock.calls.filter(
      (call) => (call[0] as { type?: string })?.type === 'graphData',
    );
    expect(graphDataCalls).toHaveLength(0);

    // Theme message should still have been posted.
    const themeCalls = postMessage.mock.calls.filter((call) => (call[0] as { type?: string })?.type === 'theme');
    expect(themeCalls).toHaveLength(1);
  });
});
