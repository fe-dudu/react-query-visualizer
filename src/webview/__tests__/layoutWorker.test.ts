/* @vitest-environment jsdom */
import '../../testing/setup';
import { afterEach, describe, expect, it, vi } from 'vitest';

let originalOnMessage: ((event: MessageEvent) => void) | null | undefined;

afterEach(() => {
  if (originalOnMessage !== undefined) {
    (self as typeof self & { onmessage: ((event: MessageEvent) => void) | null }).onmessage = originalOnMessage;
    originalOnMessage = undefined;
  }
  vi.doUnmock('../layout/layout');
  vi.resetModules();
});

describe('webview/layoutWorker', () => {
  it('posts layouted results', async () => {
    const postMessage = vi.spyOn(self, 'postMessage').mockImplementation(() => undefined as never);
    originalOnMessage = (self as typeof self & { onmessage: ((event: MessageEvent) => void) | null }).onmessage;
    vi.resetModules();
    await import('../layoutWorker');

    (self as typeof self & { onmessage: (event: MessageEvent) => void }).onmessage({
      data: {
        type: 'layout',
        id: 1,
        nodes: [
          {
            id: 'file',
            type: 'rqvNode',
            data: {
              node: { kind: 'file', metrics: { projectScope: 'web:apps/web' } },
              title: 'file',
              subtitle: 'file',
            },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
        options: {
          direction: 'LR',
          verticalSpacing: 20,
          horizontalSpacing: 400,
        },
      },
    } as MessageEvent);

    expect(postMessage).toHaveBeenCalled();
  });

  it('posts layout errors when layouting fails', async () => {
    vi.doMock('../layout/layout', () => ({
      getLayoutedElements: () => {
        throw new Error('boom');
      },
    }));
    const postMessage = vi.spyOn(self, 'postMessage').mockImplementation(() => undefined as never);
    originalOnMessage = (self as typeof self & { onmessage: ((event: MessageEvent) => void) | null }).onmessage;
    vi.resetModules();
    await import('../layoutWorker');

    (self as typeof self & { onmessage: (event: MessageEvent) => void }).onmessage({
      data: {
        type: 'layout',
        id: 2,
        nodes: [],
        edges: [],
        options: {
          direction: 'LR',
          verticalSpacing: 20,
          horizontalSpacing: 400,
        },
      },
    } as MessageEvent);

    expect(postMessage).toHaveBeenCalledWith({
      type: 'layout-error',
      id: 2,
      message: 'boom',
    });
  });

  it('ignores messages that are not layout requests', async () => {
    const postMessage = vi.spyOn(self, 'postMessage').mockImplementation(() => undefined as never);
    originalOnMessage = (self as typeof self & { onmessage: ((event: MessageEvent) => void) | null }).onmessage;
    vi.resetModules();
    await import('../layoutWorker');

    (self as typeof self & { onmessage: (event: MessageEvent) => void }).onmessage({
      data: {
        type: 'noop',
      },
    } as MessageEvent);

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('posts a worker error when the worker throws after accepting a layout request', async () => {
    const postMessage = vi.spyOn(self, 'postMessage').mockImplementation(() => undefined as never);
    originalOnMessage = (self as typeof self & { onmessage: ((event: MessageEvent) => void) | null }).onmessage;
    vi.doMock('../layout/layout', () => ({
      getLayoutedElements: () => {
        throw new Error('layout exploded');
      },
    }));
    vi.resetModules();
    await import('../layoutWorker');

    (self as typeof self & { onmessage: (event: MessageEvent) => void }).onmessage({
      data: {
        type: 'layout',
        id: 3,
        nodes: [],
        edges: [],
        options: {
          direction: 'LR',
          verticalSpacing: 20,
          horizontalSpacing: 400,
        },
      },
    } as MessageEvent);

    expect(postMessage).toHaveBeenCalledWith({
      type: 'layout-error',
      id: 3,
      message: 'layout exploded',
    });
  });

  it('stringifies non-error layout failures', async () => {
    const postMessage = vi.spyOn(self, 'postMessage').mockImplementation(() => undefined as never);
    originalOnMessage = (self as typeof self & { onmessage: ((event: MessageEvent) => void) | null }).onmessage;
    vi.doMock('../layout/layout', () => ({
      getLayoutedElements: () => {
        throw new Error('layout failed');
      },
    }));
    vi.resetModules();
    await import('../layoutWorker');

    (self as typeof self & { onmessage: (event: MessageEvent) => void }).onmessage({
      data: {
        type: 'layout',
        id: 4,
        nodes: [],
        edges: [],
        options: {
          direction: 'LR',
          verticalSpacing: 20,
          horizontalSpacing: 400,
        },
      },
    } as MessageEvent);

    expect(postMessage).toHaveBeenCalledWith({
      type: 'layout-error',
      id: 4,
      message: 'layout failed',
    });
  });

  it('stringifies a non-Error thrown value', async () => {
    const postMessage = vi.spyOn(self, 'postMessage').mockImplementation(() => undefined as never);
    originalOnMessage = (self as typeof self & { onmessage: ((event: MessageEvent) => void) | null }).onmessage;
    vi.doMock('../layout/layout', () => ({
      getLayoutedElements: () => {
        throw 'string error value' as never;
      },
    }));
    vi.resetModules();
    await import('../layoutWorker');

    (self as typeof self & { onmessage: (event: MessageEvent) => void }).onmessage({
      data: {
        type: 'layout',
        id: 5,
        nodes: [],
        edges: [],
        options: {
          direction: 'LR',
          verticalSpacing: 20,
          horizontalSpacing: 400,
        },
      },
    } as MessageEvent);

    expect(postMessage).toHaveBeenCalledWith({
      type: 'layout-error',
      id: 5,
      message: 'string error value',
    });
  });
});
