import type { Edge, Node } from '@xyflow/react';

import { type LayoutOptions, getLayoutedElements } from './layout/layout';

interface LayoutWorkerRequest {
  type: 'layout';
  id: number;
  nodes: Node[];
  edges: Edge[];
  options: LayoutOptions;
}

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

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<LayoutWorkerRequest>) => void) | null;
  postMessage: (message: LayoutWorkerResponse) => void;
};

workerScope.onmessage = (event) => {
  const message = event.data;
  if (message?.type !== 'layout') {
    return;
  }

  try {
    const layouted = getLayoutedElements(message.nodes, message.edges, message.options);
    workerScope.postMessage({
      type: 'layouted',
      id: message.id,
      nodes: layouted.nodes,
      edges: layouted.edges,
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'layout-error',
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
