import type { Edge, Node } from '@xyflow/react';
import { useCallback, useEffect, useRef } from 'react';

import { type LayoutOptions, getLayoutedElements } from '../layout';

type LayoutWorkerRequest = {
  type: 'layout';
  id: number;
  nodes: Node[];
  edges: Edge[];
  options: LayoutOptions;
};

type LayoutWorkerResponse =
  | {
      type: 'layouted';
      id: number;
      nodes: Node[];
      edges: Edge[];
    }
  | {
      type: 'layout-error';
      id: number;
      message: string;
    };

type LayoutWorkerCallback = {
  resolve: (value: { nodes: Node[]; edges: Edge[] }) => void;
  reject: (reason: Error) => void;
};

declare global {
  interface Window {
    __RQV_LAYOUT_WORKER_URI__?: string;
  }
}

export function useDagreLayoutWorker(): (
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions,
) => Promise<{ nodes: Node[]; edges: Edge[] }> {
  const workerRef = useRef<Worker | null>(null);
  const workerBlobUrlRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const callbacksRef = useRef<Map<number, LayoutWorkerCallback>>(new Map());

  const rejectPending = useCallback((error: Error) => {
    for (const callback of callbacksRef.current.values()) {
      callback.reject(error);
    }
    callbacksRef.current.clear();
  }, []);

  const getWorker = useCallback(async (): Promise<Worker | null> => {
    if (workerRef.current) {
      return workerRef.current;
    }

    const workerUri = window.__RQV_LAYOUT_WORKER_URI__;
    if (!workerUri) {
      return null;
    }

    try {
      const response = await fetch(workerUri);
      if (!response.ok) {
        return null;
      }

      const workerBlob = await response.blob();
      const workerBlobUrl = URL.createObjectURL(workerBlob);
      const worker = new Worker(workerBlobUrl);
      worker.onmessage = (event: MessageEvent<LayoutWorkerResponse>) => {
        const message = event.data;
        const callback = callbacksRef.current.get(message.id);
        if (!callback) {
          return;
        }

        callbacksRef.current.delete(message.id);
        if (message.type === 'layouted') {
          callback.resolve({ nodes: message.nodes, edges: message.edges });
          return;
        }

        callback.reject(new Error(message.message));
      };
      worker.onerror = (event) => {
        const error = new Error(event.message || 'Dagre layout worker failed');
        rejectPending(error);
        worker.terminate();
        if (workerRef.current === worker) {
          workerRef.current = null;
        }
        if (workerBlobUrlRef.current === workerBlobUrl) {
          URL.revokeObjectURL(workerBlobUrl);
          workerBlobUrlRef.current = null;
        }
      };
      workerBlobUrlRef.current = workerBlobUrl;
      workerRef.current = worker;
      return worker;
    } catch {
      return null;
    }
  }, [rejectPending]);

  useEffect(() => {
    return () => {
      rejectPending(new Error('Dagre layout worker was disposed'));
      workerRef.current?.terminate();
      workerRef.current = null;
      if (workerBlobUrlRef.current) {
        URL.revokeObjectURL(workerBlobUrlRef.current);
        workerBlobUrlRef.current = null;
      }
    };
  }, [rejectPending]);

  return useCallback(
    async (nodes: Node[], edges: Edge[], options: LayoutOptions) => {
      const worker = await getWorker();
      if (!worker) {
        return getLayoutedElements(nodes, edges, options);
      }

      return new Promise<{ nodes: Node[]; edges: Edge[] }>((resolve, reject) => {
        requestIdRef.current += 1;
        const id = requestIdRef.current;
        callbacksRef.current.set(id, { resolve, reject });
        const message: LayoutWorkerRequest = {
          type: 'layout',
          id,
          nodes,
          edges,
          options,
        };

        try {
          worker.postMessage(message);
        } catch (error) {
          callbacksRef.current.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    [getWorker],
  );
}
