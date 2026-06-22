/* @vitest-environment jsdom */
import '../../../testing/setup';
import type { Edge, Node } from '@xyflow/react';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDagreLayoutWorker } from '../useDagreLayoutWorker';

let originalWorker: typeof Worker | undefined;
let originalFetch: typeof fetch | undefined;
let originalCreateObjectURL: typeof URL.createObjectURL | undefined;
let originalRevokeObjectURL: typeof URL.revokeObjectURL | undefined;

afterEach(() => {
  if (originalWorker) {
    globalThis.Worker = originalWorker;
    originalWorker = undefined;
  }
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = undefined;
  }
  if (originalCreateObjectURL) {
    URL.createObjectURL = originalCreateObjectURL;
    originalCreateObjectURL = undefined;
  }
  if (originalRevokeObjectURL) {
    URL.revokeObjectURL = originalRevokeObjectURL;
    originalRevokeObjectURL = undefined;
  }
  (window as typeof window & { __RQV_LAYOUT_WORKER_URI__?: string }).__RQV_LAYOUT_WORKER_URI__ = undefined;
});

describe('webview/layout/useDagreLayoutWorker', () => {
  it('falls back to the local layout when no worker uri is available', async () => {
    let latest: ReturnType<typeof useDagreLayoutWorker> | undefined;

    function Harness() {
      const result = useDagreLayoutWorker();
      useEffect(() => {
        latest = result;
      }, [result]);
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });

    const nodes: Node[] = [
      {
        id: 'file',
        type: 'rqvNode',
        data: { node: { kind: 'file', metrics: { projectScope: 'web:apps/web' } }, title: 'file', subtitle: 'file' },
        position: { x: 0, y: 0 },
      },
    ];
    const edges: Edge[] = [];
    const result = await latest?.(nodes, edges, {
      direction: 'LR',
      verticalSpacing: 20,
      horizontalSpacing: 400,
    });
    if (!result) {
      throw new Error('Missing layout result');
    }

    expect(result.edges).toBe(edges);
    expect(result.nodes[0]?.width).toBe(340);
    root.unmount();
  });

  it('uses the worker when one is available and cleans it up', async () => {
    originalWorker = globalThis.Worker;
    originalFetch = globalThis.fetch;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;

    const workers: Array<{
      postMessage: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
      onmessage: ((event: MessageEvent) => void) | null;
      onerror: ((event: ErrorEvent) => void) | null;
    }> = [];

    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage = vi.fn((message: { id: number; nodes: Node[]; edges: Edge[] }) => {
        queueMicrotask(() => {
          this.onmessage?.({
            data: {
              type: 'layouted',
              id: message.id,
              nodes: message.nodes,
              edges: message.edges,
            },
          } as MessageEvent);
        });
      });
      terminate = vi.fn();

      constructor() {
        workers.push(this);
      }
    }

    const fetchMock: typeof fetch = vi.fn(async () => new Response(new Blob(['self.onmessage = () => {};'])));
    Reflect.set(globalThis, 'fetch', fetchMock);
    Reflect.set(
      URL,
      'createObjectURL',
      vi.fn(() => 'blob:worker'),
    );
    Reflect.set(URL, 'revokeObjectURL', vi.fn());
    Reflect.set(globalThis, 'Worker', FakeWorker);
    window.__RQV_LAYOUT_WORKER_URI__ = 'worker://layout';

    let latest: ReturnType<typeof useDagreLayoutWorker> | undefined;

    function Harness() {
      const result = useDagreLayoutWorker();
      useEffect(() => {
        latest = result;
      }, [result]);
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });

    const promise = latest?.(
      [
        {
          id: 'file',
          type: 'rqvNode',
          data: { node: { kind: 'file', metrics: { projectScope: 'web:apps/web' } }, title: 'file', subtitle: 'file' },
          position: { x: 0, y: 0 },
        },
      ],
      [],
      {
        direction: 'LR',
        verticalSpacing: 20,
        horizontalSpacing: 400,
      },
    );

    const result = await promise;
    if (!result) {
      throw new Error('Missing worker layout result');
    }
    expect(workers).toHaveLength(1);
    expect(workers[0]?.postMessage).toHaveBeenCalledTimes(1);
    expect(result.nodes[0]?.id).toBe('file');

    root.unmount();
    expect(workers[0]?.terminate).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:worker');
  });

  it('falls back to the local layout when worker fetch returns a non-ok response', async () => {
    originalFetch = globalThis.fetch;
    Reflect.set(
      globalThis,
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    window.__RQV_LAYOUT_WORKER_URI__ = 'worker://layout';

    let latest: ReturnType<typeof useDagreLayoutWorker> | undefined;

    function Harness() {
      const result = useDagreLayoutWorker();
      useEffect(() => {
        latest = result;
      }, [result]);
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });

    const result = await latest?.(
      [
        {
          id: 'file',
          type: 'rqvNode',
          data: { node: { kind: 'file', metrics: { projectScope: 'web:apps/web' } }, title: 'file', subtitle: 'file' },
          position: { x: 0, y: 0 },
        },
      ],
      [],
      {
        direction: 'LR',
        verticalSpacing: 20,
        horizontalSpacing: 400,
      },
    );

    expect(result?.nodes[0]?.width).toBe(340);
    root.unmount();
  });

  it('falls back to the local layout when worker fetch throws', async () => {
    originalFetch = globalThis.fetch;
    Reflect.set(
      globalThis,
      'fetch',
      vi.fn(async () => {
        throw new Error('network failed');
      }),
    );
    window.__RQV_LAYOUT_WORKER_URI__ = 'worker://layout';

    let latest: ReturnType<typeof useDagreLayoutWorker> | undefined;

    function Harness() {
      const result = useDagreLayoutWorker();
      useEffect(() => {
        latest = result;
      }, [result]);
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });

    const result = await latest?.(
      [
        {
          id: 'file',
          type: 'rqvNode',
          data: { node: { kind: 'file', metrics: { projectScope: 'web:apps/web' } }, title: 'file', subtitle: 'file' },
          position: { x: 0, y: 0 },
        },
      ],
      [],
      {
        direction: 'LR',
        verticalSpacing: 20,
        horizontalSpacing: 400,
      },
    );

    expect(result?.nodes[0]?.width).toBe(340);
    root.unmount();
  });

  it('rejects when the worker reports an error and when postMessage throws', async () => {
    originalWorker = globalThis.Worker;
    originalFetch = globalThis.fetch;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;

    const workers: Array<{
      postMessage: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
      onmessage: ((event: MessageEvent) => void) | null;
      onerror: ((event: ErrorEvent) => void) | null;
    }> = [];

    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage = vi.fn((message: { id: number }) => {
        queueMicrotask(() => {
          this.onmessage?.({
            data: {
              type: 'layout-error',
              id: message.id,
              message: 'layout failed',
            },
          } as MessageEvent);
        });
      });
      terminate = vi.fn();

      constructor() {
        workers.push(this);
      }
    }

    Reflect.set(
      globalThis,
      'fetch',
      vi.fn(async () => new Response(new Blob(['self.onmessage = () => {};']))),
    );
    Reflect.set(
      URL,
      'createObjectURL',
      vi.fn(() => 'blob:worker'),
    );
    Reflect.set(URL, 'revokeObjectURL', vi.fn());
    Reflect.set(globalThis, 'Worker', FakeWorker);
    window.__RQV_LAYOUT_WORKER_URI__ = 'worker://layout';

    let latest: ReturnType<typeof useDagreLayoutWorker> | undefined;

    function Harness() {
      const result = useDagreLayoutWorker();
      useEffect(() => {
        latest = result;
      }, [result]);
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });

    await expect(
      latest?.(
        [
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
        [],
        {
          direction: 'LR',
          verticalSpacing: 20,
          horizontalSpacing: 400,
        },
      ),
    ).rejects.toThrow('layout failed');

    const throwingWorker = workers[0];
    if (!throwingWorker) {
      throw new Error('Missing worker');
    }

    throwingWorker.onmessage?.({
      data: {
        type: 'layouted',
        id: 999,
        nodes: [],
        edges: [],
      },
    } as MessageEvent);

    throwingWorker.postMessage.mockImplementationOnce(() => {
      throw new Error('postMessage failed');
    });

    await expect(
      latest?.(
        [
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
        [],
        {
          direction: 'LR',
          verticalSpacing: 20,
          horizontalSpacing: 400,
        },
      ),
    ).rejects.toThrow('postMessage failed');

    throwingWorker.postMessage.mockImplementationOnce(() => {
      throw String('postMessage failed as string');
    });

    await expect(
      latest?.(
        [
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
        [],
        {
          direction: 'LR',
          verticalSpacing: 20,
          horizontalSpacing: 400,
        },
      ),
    ).rejects.toThrow('postMessage failed as string');

    root.unmount();
  });

  it('rejects when the worker emits an error event', async () => {
    originalWorker = globalThis.Worker;
    originalFetch = globalThis.fetch;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;

    let workerInstance: {
      onmessage: ((event: MessageEvent) => void) | null;
      onerror: ((event: ErrorEvent) => void) | null;
      postMessage: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
    } | null = null;

    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage = vi.fn();
      terminate = vi.fn();

      constructor() {
        workerInstance = this;
      }
    }

    Reflect.set(
      globalThis,
      'fetch',
      vi.fn(async () => new Response(new Blob(['self.onmessage = () => {};']))),
    );
    Reflect.set(
      URL,
      'createObjectURL',
      vi.fn(() => 'blob:worker'),
    );
    Reflect.set(URL, 'revokeObjectURL', vi.fn());
    Reflect.set(globalThis, 'Worker', FakeWorker);
    window.__RQV_LAYOUT_WORKER_URI__ = 'worker://layout';

    let latest: ReturnType<typeof useDagreLayoutWorker> | undefined;

    function Harness() {
      const result = useDagreLayoutWorker();
      useEffect(() => {
        latest = result;
      }, [result]);
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });

    const pending = latest?.(
      [
        {
          id: 'file',
          type: 'rqvNode',
          data: { node: { kind: 'file', metrics: { projectScope: 'web:apps/web' } }, title: 'file', subtitle: 'file' },
          position: { x: 0, y: 0 },
        },
      ],
      [],
      {
        direction: 'LR',
        verticalSpacing: 20,
        horizontalSpacing: 400,
      },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const currentWorker = workerInstance as {
      onmessage: ((event: MessageEvent) => void) | null;
      onerror: ((event: ErrorEvent) => void) | null;
      postMessage: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
    } | null;
    if (!currentWorker) {
      throw new Error('Missing worker instance');
    }

    currentWorker.onerror?.({ message: '' } as ErrorEvent);
    await expect(pending).rejects.toThrow('Dagre layout worker failed');
    root.unmount();
  });

  it('rejects pending work when the hook unmounts', async () => {
    originalWorker = globalThis.Worker;
    originalFetch = globalThis.fetch;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;

    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage = vi.fn();
      terminate = vi.fn();
    }

    Reflect.set(
      globalThis,
      'fetch',
      vi.fn(async () => new Response(new Blob(['self.onmessage = () => {};']))),
    );
    Reflect.set(
      URL,
      'createObjectURL',
      vi.fn(() => 'blob:worker'),
    );
    Reflect.set(URL, 'revokeObjectURL', vi.fn());
    Reflect.set(globalThis, 'Worker', FakeWorker);
    window.__RQV_LAYOUT_WORKER_URI__ = 'worker://layout';

    let latest: ReturnType<typeof useDagreLayoutWorker> | undefined;

    function Harness() {
      const result = useDagreLayoutWorker();
      useEffect(() => {
        latest = result;
      }, [result]);
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });

    const layoutPromise = latest?.(
      [
        {
          id: 'file',
          type: 'rqvNode',
          data: { node: { kind: 'file', metrics: { projectScope: 'web:apps/web' } }, title: 'file', subtitle: 'file' },
          position: { x: 0, y: 0 },
        },
      ],
      [],
      {
        direction: 'LR',
        verticalSpacing: 20,
        horizontalSpacing: 400,
      },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    root.unmount();
    await expect(layoutPromise).rejects.toThrow('Dagre layout worker was disposed');
  });
});
