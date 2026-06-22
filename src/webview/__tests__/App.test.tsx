/* @vitest-environment jsdom */
import '../../testing/setup';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
  document.body.className = '';
  document.body.removeAttribute('style');
});

describe('webview/App', () => {
  it('boots the app shell and syncs host theme changes', async () => {
    const postMessage = vi.fn();
    vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage }));
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const observers: Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();

        constructor() {
          observers.push(this);
        }
      },
    );

    vi.resetModules();
    vi.doMock('../components/GraphCanvas', () => ({
      GraphCanvas: () => <div data-testid="graph-canvas" />,
    }));

    const { default: App } = await import('../App');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
    });

    expect(postMessage).toHaveBeenCalledWith({ type: 'ready' });
    expect(container.querySelector('[data-testid="graph-canvas"]')).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'theme', isDark: true } }));
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'theme', isDark: false } }));
    });
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'theme', themeKind: 2, isDark: false } }));
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'graphData' } }));
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'graphData',
            payload: {
              graph: {
                nodes: [],
                edges: [],
                summary: { files: 0, actions: 0, queryKeys: 0, parseErrors: 0 },
                parseErrors: [],
              },
              scannedFiles: [],
              scopeLabel: 'payload',
              layout: { direction: 'LR', engine: 'dagre', verticalSpacing: 30, horizontalSpacing: 500 },
            },
          },
        }),
      );
    });

    root.unmount();
    expect(observers[0]?.observe).toHaveBeenCalled();
    expect(observers[0]?.disconnect).toHaveBeenCalled();
  });
});
