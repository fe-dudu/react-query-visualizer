/* @vitest-environment jsdom */
import '../../../testing/setup';
import type { ComponentType, ReactNode } from 'react';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WebviewPayload } from '../../../shared/contracts';
import { createGraph, createGraphEdge, createGraphNode, createScannedFile } from '../../../testing/fixtures';

type FlowProps = {
  nodes?: Array<{ id: string; type: string; data: unknown }>;
  edges?: Array<{ id: string }>;
  nodeTypes?: Record<string, ComponentType<{ data: unknown }>>;
  children?: ReactNode;
  onNodeClick?: (event: unknown, node: unknown) => void;
  onNodeDoubleClick?: (event: unknown, node: unknown) => void;
  onPaneClick?: () => void;
};

const graphFlow = vi.hoisted(() => {
  const state: {
    props: FlowProps | undefined;
    leftPanelProps: {
      onSelectQueryKey?: (queryKeyLabel: string) => void;
      onSelectRelatedFile?: (filePath: string) => void;
      onVerticalSpacingChange?: (value: number) => void;
      onHorizontalSpacingChange?: (value: number) => void;
      setFilters?: (value: unknown) => void;
      showProjectDividers?: boolean;
      relatedFiles?: WebviewPayload['scannedFiles'];
    };
    rejectLayout: boolean;
    api: {
      fitView: ReturnType<typeof vi.fn>;
      getViewport: ReturnType<typeof vi.fn>;
      setViewport: ReturnType<typeof vi.fn>;
    };
    activeResizer: 'left' | 'right' | null;
    deferredLayout: {
      promise: Promise<{ nodes: unknown[]; edges: unknown[] }>;
      resolve: (value: { nodes: unknown[]; edges: unknown[] }) => void;
    } | null;
  } = {
    props: undefined,
    leftPanelProps: {},
    rejectLayout: false,
    api: {
      fitView: vi.fn().mockResolvedValue(undefined),
      getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
      setViewport: vi.fn().mockResolvedValue(undefined),
    },
    activeResizer: null,
    deferredLayout: null,
  };

  return state;
});

vi.mock('@xyflow/react', () => ({
  BackgroundVariant: { Lines: 'lines' },
  ConnectionLineType: { Bezier: 'bezier' },
  Position: { Left: 'left', Right: 'right' },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
  ReactFlow: (props: FlowProps) => {
    graphFlow.props = props;
    const renderedNodes = (props.nodes ?? []).map((node) => {
      const NodeComponent = props.nodeTypes?.[node.type];
      return NodeComponent ? createElement(NodeComponent, { key: node.id, data: node.data }) : null;
    });

    return createElement(
      'div',
      { 'data-testid': 'reactflow' },
      ...renderedNodes,
      ...(Array.isArray(props.children) ? props.children : [props.children]),
    );
  },
  Handle: ({ id, type, position }: { id: string; type: string; position: string }) =>
    createElement('span', { 'data-handle': id, 'data-type': type, 'data-position': position }),
  Controls: () => createElement('span', { 'data-testid': 'controls' }),
  MiniMap: () => createElement('span', { 'data-testid': 'minimap' }),
  Background: () => createElement('span', { 'data-testid': 'background' }),
  useReactFlow: () => graphFlow.api,
}));

const stableLayoutFn = async <TNode, TEdge>(nodes: TNode[], edges: TEdge[]) => {
  if (graphFlow.rejectLayout) {
    throw new Error('layout worker failed');
  }
  if (graphFlow.deferredLayout) {
    return graphFlow.deferredLayout.promise as Promise<{ nodes: TNode[]; edges: TEdge[] }>;
  }
  return { nodes, edges };
};

vi.mock('../../layout/useDagreLayoutWorker', () => ({
  useDagreLayoutWorker: () => stableLayoutFn,
}));

vi.mock('../../layout/useResizablePanels', () => ({
  useResizablePanels: () => ({
    shellRef: { current: null },
    shellStyle: {
      '--rqv-left-width': '280px',
      '--rqv-right-width': '300px',
    },
    activeResizer: graphFlow.activeResizer,
    startResize: () => () => undefined,
  }),
}));

vi.mock('../LeftPanel', () => ({
  LeftPanel: (props: typeof graphFlow.leftPanelProps) => {
    graphFlow.leftPanelProps = props;
    return createElement('aside', { 'data-testid': 'left-panel' });
  },
}));

afterEach(() => {
  vi.useRealTimers();
  graphFlow.props = undefined;
  graphFlow.leftPanelProps = {};
  graphFlow.rejectLayout = false;
  graphFlow.activeResizer = null;
  graphFlow.deferredLayout = null;
  graphFlow.api.fitView.mockReset();
  graphFlow.api.fitView.mockResolvedValue(undefined);
  graphFlow.api.getViewport.mockReset();
  graphFlow.api.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
  graphFlow.api.setViewport.mockReset();
  graphFlow.api.setViewport.mockResolvedValue(undefined);
});

describe('webview/components/GraphCanvas', () => {
  it('renders the graph shell and drives node interactions', async () => {
    vi.useFakeTimers();
    graphFlow.activeResizer = 'left';
    const payload = {
      graph: createGraph({
        nodes: [
          createGraphNode({
            id: 'file-web',
            kind: 'file',
            label: 'web/src/query.ts',
            file: '/workspace/web/src/query.ts',
            resolution: 'static',
            metrics: { affectedKeys: 2, projectScope: 'web:apps/web' },
          }),
          createGraphNode({
            id: 'action-web',
            kind: 'action',
            label: 'invalidateTodos',
            file: '/workspace/web/src/query.ts',
            resolution: 'static',
            loc: { line: 10, column: 2 },
            metrics: { relation: 'invalidates', displayFile: 'web/src/query.ts', projectScope: 'web:apps/web' },
          }),
          createGraphNode({
            id: 'query-web',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
            metrics: {
              rootSegment: 'todo',
              projectScope: 'web:apps/web',
              affectedFiles: 2,
              declaredFiles: 1,
              declaredCallsites: 1,
            },
          }),
          createGraphNode({
            id: 'query-web-duplicate',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
            metrics: {
              rootSegment: 'todo',
              projectScope: 'web:apps/web',
              affectedFiles: 4,
            },
          }),
          createGraphNode({
            id: 'file-api',
            kind: 'file',
            label: 'api/src/query.ts',
            file: '/workspace/api/src/query.ts',
            resolution: 'static',
            metrics: { affectedKeys: 1, projectScope: 'api:packages/api' },
          }),
          createGraphNode({
            id: 'action-api',
            kind: 'action',
            label: 'setUsers',
            file: '/workspace/api/src/query.ts',
            resolution: 'static',
            loc: { line: 8, column: 1 },
            metrics: { relation: 'sets', displayFile: 'api/src/query.ts', projectScope: 'api:packages/api' },
          }),
          createGraphNode({
            id: 'query-api',
            kind: 'queryKey',
            label: 'users',
            resolution: 'static',
            metrics: { rootSegment: 'users', projectScope: 'api:packages/api', affectedFiles: 1 },
          }),
        ],
        edges: [
          createGraphEdge({
            id: 'file-web-action-web',
            source: 'file-web',
            target: 'action-web',
            relation: 'invalidates',
          }),
          createGraphEdge({
            id: 'action-web-query-web',
            source: 'action-web',
            target: 'query-web',
            relation: 'invalidates',
          }),
          createGraphEdge({ id: 'file-api-action-api', source: 'file-api', target: 'action-api', relation: 'sets' }),
          createGraphEdge({ id: 'action-api-query-api', source: 'action-api', target: 'query-api', relation: 'sets' }),
        ],
      }),
      scannedFiles: [
        createScannedFile({ workspace: 'web', path: 'web/src/query.ts', depth: 1 }),
        createScannedFile({ workspace: 'api', path: 'api/src/query.ts', depth: 1 }),
      ],
      scopeLabel: 'All files',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const { GraphCanvas } = await import('../GraphCanvas');
    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      const fitViewResult = graphFlow.api.fitView.mock.results[graphFlow.api.fitView.mock.results.length - 1]?.value;
      await fitViewResult;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="reactflow"]')).toBeTruthy();
    expect(container.textContent).toContain('todo');
    expect(container.textContent).toContain('web/apps/web');

    const fileNode = payload.graph.nodes.find((node) => node.id === 'file-web');
    if (!fileNode) {
      throw new Error('Missing file node');
    }

    await act(async () => {
      graphFlow.props?.onNodeClick?.({}, { id: 'divider:web' });
      graphFlow.props?.onNodeClick?.({}, fileNode);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Open in code');
    expect(container.textContent).toContain('Callsites');

    const openButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open in code'),
    );
    openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const firstCallsiteButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('invalidateTodos'),
    );
    firstCallsiteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const firstFileButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('web/src/query.ts'),
    );
    firstFileButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await act(async () => {
      graphFlow.leftPanelProps.onSelectRelatedFile?.('missing.ts');
      graphFlow.leftPanelProps.onSelectRelatedFile?.('web/src/query.ts');
      graphFlow.leftPanelProps.onSelectQueryKey?.('missing');
      graphFlow.leftPanelProps.onSelectQueryKey?.('todo');
      graphFlow.leftPanelProps.onVerticalSpacingChange?.(999);
      graphFlow.leftPanelProps.onHorizontalSpacingChange?.(1);
      graphFlow.leftPanelProps.setFilters?.((current: unknown) => current);
      graphFlow.props?.onNodeDoubleClick?.({}, fileNode);
      graphFlow.props?.onNodeDoubleClick?.({}, { id: 'divider:web' });
      graphFlow.props?.onNodeDoubleClick?.({}, { id: 'missing' });
      graphFlow.props?.onPaneClick?.();
      await Promise.resolve();
    });

    await act(async () => {
      graphFlow.leftPanelProps.onSelectQueryKey?.('todo');
      await Promise.resolve();
    });
    await act(async () => {
      graphFlow.leftPanelProps.onSelectQueryKey?.('todo');
      await Promise.resolve();
    });

    root.unmount();
  });

  it('falls back when the layout worker rejects and skips viewport alignment for empty graphs', async () => {
    vi.useFakeTimers();
    graphFlow.rejectLayout = true;
    const payload = {
      graph: createGraph({ nodes: [], edges: [] }),
      scannedFiles: [],
      scopeLabel: 'Empty',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { GraphCanvas } = await import('../GraphCanvas');

    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(graphFlow.api.fitView).toHaveBeenCalled();
    root.unmount();
  });

  it('ignores viewport alignment after unmount', async () => {
    vi.useFakeTimers();
    let resolveFitView: () => void = () => undefined;
    graphFlow.api.fitView.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveFitView = () => resolve();
      }),
    );
    const payload = {
      graph: createGraph({
        nodes: [
          createGraphNode({
            id: 'file',
            kind: 'file',
            label: 'src/query.ts',
            file: '/workspace/src/query.ts',
            resolution: 'static',
            metrics: { affectedKeys: 1, projectScope: 'web:apps/web' },
          }),
          createGraphNode({
            id: 'action',
            kind: 'action',
            label: 'invalidate',
            file: '/workspace/src/query.ts',
            resolution: 'static',
            metrics: { relation: 'invalidates', displayFile: 'src/query.ts', projectScope: 'app:.' },
          }),
          createGraphNode({
            id: 'query',
            kind: 'queryKey',
            label: 'todos',
            resolution: 'static',
            metrics: { rootSegment: 'todos', projectScope: 'app:.', affectedFiles: 1 },
          }),
        ],
        edges: [
          createGraphEdge({ id: 'file-action', source: 'file', target: 'action', relation: 'invalidates' }),
          createGraphEdge({ id: 'action-query', source: 'action', target: 'query', relation: 'invalidates' }),
        ],
      }),
      scannedFiles: [],
      scopeLabel: 'One file',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { GraphCanvas } = await import('../GraphCanvas');

    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    root.unmount();

    await act(async () => {
      resolveFitView();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(graphFlow.api.setViewport).not.toHaveBeenCalled();
  });

  it('ignores a layout result that resolves after unmount', async () => {
    vi.useFakeTimers();
    let resolveLayout: (value: { nodes: unknown[]; edges: unknown[] }) => void = () => undefined;
    graphFlow.deferredLayout = {
      promise: new Promise((resolve) => {
        resolveLayout = resolve;
      }),
      resolve: resolveLayout,
    };
    const payload = {
      graph: createGraph({
        nodes: [
          createGraphNode({
            id: 'file',
            kind: 'file',
            label: 'src/query.ts',
            file: '/workspace/src/query.ts',
            resolution: 'static',
          }),
        ],
        edges: [],
      }),
      scannedFiles: [],
      scopeLabel: 'One file',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { GraphCanvas } = await import('../GraphCanvas');

    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    root.unmount();

    await act(async () => {
      resolveLayout({ nodes: [], edges: [] });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(graphFlow.api.fitView).not.toHaveBeenCalled();
  });

  it('keeps running when fit view rejects', async () => {
    vi.useFakeTimers();
    graphFlow.api.fitView.mockRejectedValueOnce(new Error('fit view failed'));
    const payload = {
      graph: createGraph({
        nodes: [
          createGraphNode({
            id: 'file',
            kind: 'file',
            label: 'src/query.ts',
            file: '/workspace/src/query.ts',
            resolution: 'static',
          }),
        ],
        edges: [],
      }),
      scannedFiles: [],
      scopeLabel: 'One file',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { GraphCanvas } = await import('../GraphCanvas');

    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(graphFlow.api.setViewport).not.toHaveBeenCalled();
    root.unmount();
  });

  it('selects duplicate query keys by deterministic fallback order without rendered layout', async () => {
    vi.useFakeTimers();
    const payload = {
      graph: createGraph({
        nodes: [
          createGraphNode({
            id: 'query-b',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
            metrics: { affectedFiles: 1 },
          }),
          createGraphNode({
            id: 'query-a',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
          }),
        ],
        edges: [],
      }),
      scannedFiles: [],
      scopeLabel: 'Queries',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { GraphCanvas } = await import('../GraphCanvas');

    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    await act(async () => {
      graphFlow.leftPanelProps.onSelectQueryKey?.('todo');
      await Promise.resolve();
    });

    expect(container.textContent).toContain('todo is referenced by 0 callsites in 0 files.');
    root.unmount();
  });

  it('clears selection on pane click and ignores missing targets for selection and double clicks', async () => {
    vi.useFakeTimers();
    const payload = {
      graph: createGraph({
        nodes: [
          createGraphNode({
            id: 'file-web',
            kind: 'file',
            label: 'web/src/query.ts',
            file: '/workspace/web/src/query.ts',
            resolution: 'static',
          }),
          createGraphNode({
            id: 'query-web-a',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
            metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', affectedFiles: 1 },
          }),
          createGraphNode({
            id: 'query-web-b',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
            metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', affectedFiles: 5 },
          }),
        ],
        edges: [],
      }),
      scannedFiles: [],
      scopeLabel: 'Queries',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { GraphCanvas } = await import('../GraphCanvas');

    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      graphFlow.props?.onNodeClick?.({}, { id: 'divider:web' });
      graphFlow.props?.onNodeClick?.({}, { id: 'query-web-b' });
      await Promise.resolve();
    });

    await act(async () => {
      graphFlow.leftPanelProps.onSelectQueryKey?.('todo');
      graphFlow.props?.onPaneClick?.();
      graphFlow.props?.onNodeDoubleClick?.({}, { id: 'query-web-b' });
      graphFlow.props?.onNodeDoubleClick?.({}, { id: 'missing' });
      graphFlow.leftPanelProps.onSelectQueryKey?.('missing');
      graphFlow.leftPanelProps.onSelectRelatedFile?.('missing.ts');
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain('todo is referenced by');
    root.unmount();
  });

  it('calls setViewport after fitView resolves with a non-null minY', async () => {
    vi.useFakeTimers();
    // Use a manually controlled fitView promise so we can drain the .then chain precisely.
    let resolveFitView!: (value: unknown) => void;
    const fitViewPromise = new Promise((resolve) => {
      resolveFitView = resolve;
    });
    graphFlow.api.fitView.mockReturnValueOnce(fitViewPromise);
    graphFlow.api.getViewport.mockReturnValue({ x: 10, y: 20, zoom: 1 });
    const payload = {
      graph: createGraph({
        nodes: [
          createGraphNode({
            id: 'file',
            kind: 'file',
            label: 'src/query.ts',
            file: '/workspace/src/query.ts',
            resolution: 'static',
            metrics: { affectedKeys: 1, projectScope: 'app:.' },
          }),
          createGraphNode({
            id: 'action',
            kind: 'action',
            label: 'invalidate',
            file: '/workspace/src/query.ts',
            resolution: 'static',
            metrics: { relation: 'invalidates', displayFile: 'src/query.ts', projectScope: 'app:.' },
          }),
          createGraphNode({
            id: 'query',
            kind: 'queryKey',
            label: 'todos',
            resolution: 'static',
            metrics: { rootSegment: 'todos', projectScope: 'app:.', affectedFiles: 1 },
          }),
        ],
        edges: [
          createGraphEdge({ id: 'file-action', source: 'file', target: 'action', relation: 'invalidates' }),
          createGraphEdge({ id: 'action-query', source: 'action', target: 'query', relation: 'invalidates' }),
        ],
      }),
      scannedFiles: [],
      scopeLabel: 'One file',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { GraphCanvas } = await import('../GraphCanvas');

    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    // Fire the layout timer so runLayout runs and calls fitView.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // fitView should have been called with the layout result.
    expect(graphFlow.api.fitView).toHaveBeenCalled();
    // getViewport should NOT have been called yet (fitView not resolved).
    expect(graphFlow.api.getViewport).not.toHaveBeenCalled();

    // Now resolve fitView, which triggers the .then(callback) that calls setViewport.
    await act(async () => {
      resolveFitView(undefined);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // setViewport should have been called because minY is not null (nodes exist).
    expect(graphFlow.api.setViewport).toHaveBeenCalled();

    root.unmount();
  });

  it('renders a single-project graph without project dividers and keeps the left panel scoped', async () => {
    vi.useFakeTimers();
    const payload = {
      graph: createGraph({
        nodes: [
          createGraphNode({
            id: 'file-web',
            kind: 'file',
            label: 'web/src/query.ts',
            file: '/workspace/web/src/query.ts',
            resolution: 'static',
            metrics: { affectedKeys: 1, projectScope: 'web:apps/web' },
          }),
          createGraphNode({
            id: 'action-web',
            kind: 'action',
            label: 'invalidateTodos',
            file: '/workspace/web/src/query.ts',
            resolution: 'static',
            loc: { line: 2, column: 1 },
            metrics: { relation: 'invalidates', displayFile: 'web/src/query.ts', projectScope: 'web:apps/web' },
          }),
          createGraphNode({
            id: 'query-web',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
            metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', affectedFiles: 1 },
          }),
        ],
        edges: [
          createGraphEdge({
            id: 'file-web-action-web',
            source: 'file-web',
            target: 'action-web',
            relation: 'invalidates',
          }),
          createGraphEdge({
            id: 'action-web-query-web',
            source: 'action-web',
            target: 'query-web',
            relation: 'invalidates',
          }),
        ],
      }),
      scannedFiles: [createScannedFile({ workspace: 'web', path: 'web/src/query.ts', depth: 1 })],
      scopeLabel: 'Web',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { GraphCanvas } = await import('../GraphCanvas');

    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(graphFlow.leftPanelProps.showProjectDividers).toBe(false);
    expect(graphFlow.leftPanelProps.relatedFiles).toEqual([
      expect.objectContaining({ path: 'web/src/query.ts', workspace: 'web' }),
    ]);
    expect(container.textContent).toContain('todo');
    root.unmount();
  });

  it('keeps unmatched render edges and swallows viewport alignment rejections', async () => {
    vi.useFakeTimers();
    graphFlow.api.setViewport.mockRejectedValueOnce(new Error('viewport failed'));

    let resolveLayout: (value: { nodes: unknown[]; edges: unknown[] }) => void = () => undefined;
    graphFlow.deferredLayout = {
      promise: new Promise((resolve) => {
        resolveLayout = resolve;
      }),
      resolve: resolveLayout,
    };

    const payload = {
      graph: createGraph({
        nodes: [
          createGraphNode({
            id: 'file',
            kind: 'file',
            label: 'src/file.ts',
            file: '/workspace/src/file.ts',
            resolution: 'static',
            metrics: { projectScope: 'web:apps/web' },
          }),
        ],
        edges: [],
      }),
      scannedFiles: [],
      scopeLabel: 'One file',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { GraphCanvas } = await import('../GraphCanvas');

    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    await act(async () => {
      resolveLayout({
        nodes: [
          {
            id: 'file',
            type: 'rqvNode',
            data: {
              node: payload.graph.nodes[0],
              title: 'src/file.ts',
              subtitle: 'file',
              dim: false,
              highlighted: false,
              selected: false,
            },
            position: { x: 0, y: 0 },
            width: 340,
            height: 173,
          },
        ],
        edges: [
          {
            id: 'render-only-edge',
            source: 'file',
            target: 'file',
            type: 'smoothstep',
            data: { relation: 'invalidates', dim: false, highlighted: false, laneOffset: 0 },
          },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(graphFlow.props?.edges?.some((edge) => edge.id === 'render-only-edge')).toBe(true);
    expect(graphFlow.api.setViewport).not.toHaveBeenCalled();
    root.unmount();
  });

  it('selects query keys from rendered layout positions and falls back to ids', async () => {
    vi.useFakeTimers();

    let resolveLayout: (value: { nodes: unknown[]; edges: unknown[] }) => void = () => undefined;
    graphFlow.deferredLayout = {
      promise: new Promise((resolve) => {
        resolveLayout = resolve;
      }),
      resolve: resolveLayout,
    };

    const payload = {
      graph: createGraph({
        nodes: [
          createGraphNode({
            id: 'query-a',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
            metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', affectedFiles: 1 },
          }),
          createGraphNode({
            id: 'query-b',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
            metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', affectedFiles: 1 },
          }),
        ],
        edges: [],
      }),
      scannedFiles: [],
      scopeLabel: 'Queries',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { GraphCanvas } = await import('../GraphCanvas');

    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    await act(async () => {
      resolveLayout({
        nodes: [
          {
            id: 'query-a',
            type: 'rqvNode',
            data: {
              node: payload.graph.nodes[0],
              title: 'todo',
              subtitle: 'queryKey',
              dim: false,
              highlighted: false,
              selected: false,
            },
            position: { x: 100, y: 40 },
            width: 340,
            height: 173,
          },
          {
            id: 'query-b',
            type: 'rqvNode',
            data: {
              node: payload.graph.nodes[1],
              title: 'todo',
              subtitle: 'queryKey',
              dim: false,
              highlighted: false,
              selected: false,
            },
            position: { x: 40, y: 10 },
            width: 340,
            height: 173,
          },
        ],
        edges: [],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      graphFlow.leftPanelProps.onSelectQueryKey?.('todo');
      await Promise.resolve();
    });

    expect(container.textContent).toContain('todo is referenced by 0 callsites in 0 files.');

    const originalSort = Array.prototype.sort;
    const sortSpy = vi.spyOn(Array.prototype, 'sort');
    sortSpy.mockImplementation(function sortQueryNodes(
      this: unknown[],
      compareFn?: (a: unknown, b: unknown) => number,
    ) {
      if (
        this.length === 2 &&
        this.every((value) => typeof value === 'object' && value !== null && 'kind' in value && 'label' in value)
      ) {
        return [] as unknown as unknown[];
      }

      return originalSort.call(this, compareFn as never);
    });

    await act(async () => {
      graphFlow.leftPanelProps.onSelectQueryKey?.('todo');
      await Promise.resolve();
    });

    sortSpy.mockRestore();
    root.unmount();
  });

  it('updates query selection using missing rendered nodes and no-target fallback', async () => {
    vi.useFakeTimers();

    let resolveLayout: (value: { nodes: unknown[]; edges: unknown[] }) => void = () => undefined;
    graphFlow.deferredLayout = {
      promise: new Promise((resolve) => {
        resolveLayout = resolve;
      }),
      resolve: resolveLayout,
    };

    const payload = {
      graph: createGraph({
        nodes: [
          createGraphNode({
            id: 'query-b',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
            metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', affectedFiles: 1 },
          }),
          createGraphNode({
            id: 'query-a',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
            metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', affectedFiles: 1 },
          }),
        ],
        edges: [],
      }),
      scannedFiles: [],
      scopeLabel: 'Queries',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { GraphCanvas } = await import('../GraphCanvas');

    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    await act(async () => {
      resolveLayout({
        nodes: [
          {
            id: 'query-b',
            type: 'rqvNode',
            data: {
              node: payload.graph.nodes[0],
              title: 'todo',
              subtitle: 'queryKey',
              dim: false,
              highlighted: false,
              selected: false,
            },
            position: { x: 10, y: 10 },
            width: 340,
            height: 173,
          },
        ],
        edges: [],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      graphFlow.leftPanelProps.onSelectQueryKey?.('todo');
      await Promise.resolve();
    });

    expect(container.textContent).toContain('todo is referenced by 0 callsites in 0 files.');
    root.unmount();
  });

  it('skips viewport alignment when the layout result has no visible nodes', async () => {
    vi.useFakeTimers();
    let resolveFitView: () => void = () => undefined;
    graphFlow.api.fitView.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveFitView = () => resolve();
      }),
    );

    const payload = {
      graph: createGraph({ nodes: [], edges: [] }),
      scannedFiles: [],
      scopeLabel: 'Empty',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { GraphCanvas } = await import('../GraphCanvas');

    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      resolveFitView();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(graphFlow.api.setViewport).not.toHaveBeenCalled();
    root.unmount();
  });

  it('keeps viewport alignment disabled when fit view resolves after an empty layout', async () => {
    vi.useFakeTimers();
    graphFlow.api.fitView.mockResolvedValueOnce(undefined);

    const payload = {
      graph: createGraph({ nodes: [], edges: [] }),
      scannedFiles: [],
      scopeLabel: 'Empty',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { GraphCanvas } = await import('../GraphCanvas');

    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(graphFlow.api.setViewport).not.toHaveBeenCalled();
    root.unmount();
  });

  it('keeps query ordering stable when rendered positions and impact tie', async () => {
    vi.useFakeTimers();

    const payload = {
      graph: createGraph({
        nodes: [
          createGraphNode({
            id: 'query-a',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
            metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', affectedFiles: 1 },
          }),
          createGraphNode({
            id: 'query-b',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
            metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', affectedFiles: 1 },
          }),
        ],
        edges: [],
      }),
      scannedFiles: [],
      scopeLabel: 'Queries',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { GraphCanvas } = await import('../GraphCanvas');

    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      graphFlow.leftPanelProps.onSelectQueryKey?.('todo');
      await Promise.resolve();
    });

    expect(container.textContent).toContain('todo is referenced by 0 callsites in 0 files.');
    root.unmount();
  });

  it('selects the rendered query key when its sibling is missing from the render graph', async () => {
    vi.useFakeTimers();

    let resolveLayout: (value: { nodes: unknown[]; edges: unknown[] }) => void = () => undefined;
    graphFlow.deferredLayout = {
      promise: new Promise((resolve) => {
        resolveLayout = resolve;
      }),
      resolve: resolveLayout,
    };

    const payload = {
      graph: createGraph({
        nodes: [
          createGraphNode({
            id: 'query-b',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
            metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', affectedFiles: 1 },
          }),
          createGraphNode({
            id: 'query-a',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
            metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', affectedFiles: 1 },
          }),
        ],
        edges: [],
      }),
      scannedFiles: [],
      scopeLabel: 'Queries',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { GraphCanvas } = await import('../GraphCanvas');

    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    await act(async () => {
      resolveLayout({
        nodes: [
          {
            id: 'query-b',
            type: 'rqvNode',
            data: {
              node: payload.graph.nodes[0],
              title: 'todo',
              subtitle: 'queryKey',
              dim: false,
              highlighted: false,
              selected: false,
            },
            position: { x: 10, y: 10 },
            width: 340,
            height: 173,
          },
        ],
        edges: [],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      graphFlow.leftPanelProps.onSelectQueryKey?.('todo');
      await Promise.resolve();
    });

    expect(container.textContent).toContain('todo is referenced by 0 callsites in 0 files.');
    root.unmount();
  });

  it('sorts query keys by id when rendered positions and impact tie', async () => {
    vi.useFakeTimers();

    let resolveLayout: (value: { nodes: unknown[]; edges: unknown[] }) => void = () => undefined;
    graphFlow.deferredLayout = {
      promise: new Promise((resolve) => {
        resolveLayout = resolve;
      }),
      resolve: resolveLayout,
    };

    const payload = {
      graph: createGraph({
        nodes: [
          createGraphNode({
            id: 'query-b',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
            metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', affectedFiles: 1 },
          }),
          createGraphNode({
            id: 'query-a',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
            metrics: { rootSegment: 'todo', projectScope: 'web:apps/web', affectedFiles: 1 },
          }),
        ],
        edges: [],
      }),
      scannedFiles: [],
      scopeLabel: 'Queries',
      layout: {
        direction: 'LR',
        engine: 'dagre',
        verticalSpacing: 30,
        horizontalSpacing: 500,
      },
    } satisfies WebviewPayload;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { GraphCanvas } = await import('../GraphCanvas');

    await act(async () => {
      root.render(createElement(GraphCanvas, { payload }));
      await Promise.resolve();
    });

    await act(async () => {
      resolveLayout({
        nodes: [
          {
            id: 'query-b',
            type: 'rqvNode',
            data: {
              node: payload.graph.nodes[0],
              title: 'todo',
              subtitle: 'queryKey',
              dim: false,
              highlighted: false,
              selected: false,
            },
            position: { x: 10, y: 10 },
            width: 340,
            height: 173,
          },
          {
            id: 'query-a',
            type: 'rqvNode',
            data: {
              node: payload.graph.nodes[1],
              title: 'todo',
              subtitle: 'queryKey',
              dim: false,
              highlighted: false,
              selected: false,
            },
            position: { x: 10, y: 10 },
            width: 340,
            height: 173,
          },
        ],
        edges: [],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      graphFlow.leftPanelProps.onSelectQueryKey?.('todo');
      await Promise.resolve();
    });

    expect(container.textContent).toContain('todo is referenced by 0 callsites in 0 files.');
    root.unmount();
  });
});
