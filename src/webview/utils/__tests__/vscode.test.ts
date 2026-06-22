/* @vitest-environment jsdom */
import '../../../testing/setup';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  Reflect.deleteProperty(window, 'acquireVsCodeApi');
  Reflect.deleteProperty(globalThis, 'acquireVsCodeApi');
});

describe('webview/utils/vscode', () => {
  it('reads the vscode api from the global acquire function', async () => {
    const postMessage = vi.fn();
    vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage }));
    vi.resetModules();

    const { vscode } = await import('../vscode');
    expect(vscode).toBeDefined();
    vscode?.postMessage({ type: 'ready' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'ready' });
  });

  it('falls back to the window acquire function when the global is not a function', async () => {
    const postMessage = vi.fn();
    // Stub `window` to a custom object so `typeof window.acquireVsCodeApi` is 'function'
    // while the bare `acquireVsCodeApi` on globalThis is NOT defined.
    const fakeWindow = { acquireVsCodeApi: () => ({ postMessage }) };
    vi.stubGlobal('window', fakeWindow);
    // Ensure the bare global `acquireVsCodeApi` is NOT a function so the first branch is skipped.
    Reflect.deleteProperty(globalThis, 'acquireVsCodeApi');
    vi.resetModules();

    const { vscode } = await import('../vscode');
    expect(vscode).toBeDefined();
    vscode?.postMessage({ type: 'graphData' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'graphData' });
  });

  it('returns undefined when no acquire function exists', async () => {
    vi.resetModules();

    const { vscode } = await import('../vscode');
    expect(vscode).toBeUndefined();
  });
});
