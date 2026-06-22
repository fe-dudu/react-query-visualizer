import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { RqvFlowNode } from '../components/FlowNode';
import { LeftPanelQueryKeys } from '../components/LeftPanelQueryKeys';
import { LeftPanelRelatedFiles } from '../components/LeftPanelRelatedFiles';
import { ProjectDividerNode } from '../components/ProjectDividerNode';
import { ResizeDivider } from '../components/ResizeDivider';
import { RightPanel } from '../components/RightPanel';

vi.mock('@xyflow/react', () => ({
  Handle: ({ id }: { id: string }) => createElement('span', { 'data-handle': id }),
  Position: { Left: 'left', Right: 'right' },
}));

describe('webview/components', () => {
  it('renders flow nodes and project dividers', () => {
    const flowMarkup = renderToStaticMarkup(
      createElement(RqvFlowNode, {
        data: {
          node: {
            id: 'action',
            kind: 'action',
            label: 'invalidateTodos',
            file: '/workspace/src/file.ts',
            resolution: 'static',
            metrics: { relation: 'invalidates' },
          },
          title: 'invalidateTodos',
          subtitle: 'Called in src/file.ts @ 10:2',
          relation: 'invalidates',
          dim: true,
          highlighted: true,
          selected: false,
        },
      } as never),
    );
    expect(flowMarkup).toContain('invalidateTodos');
    expect(flowMarkup).toContain('Invalidate');

    const declareMarkup = renderToStaticMarkup(
      createElement(RqvFlowNode, {
        data: {
          node: {
            id: 'declare',
            kind: 'action',
            label: 'declareTodos',
            resolution: 'static',
            metrics: { relation: 'declares', declaresDirectly: 1 },
          },
          title: 'declareTodos',
          subtitle: 'Defined in src/file.ts @ 1:1',
          relation: 'declares',
          dim: false,
          highlighted: false,
          selected: true,
        },
      } as never),
    );
    expect(declareMarkup).toContain('Declare');

    const dividerMarkup = renderToStaticMarkup(
      createElement(ProjectDividerNode, {
        data: {
          label: 'web',
          width: 500,
          height: 200,
          showLabel: true,
          variant: 'bubble',
        },
      } as never),
    );
    expect(dividerMarkup).toContain('web');

    const hiddenBubbleMarkup = renderToStaticMarkup(
      createElement(ProjectDividerNode, {
        data: {
          label: 'hidden',
          width: 500,
          height: 200,
          showLabel: false,
          variant: 'bubble',
        },
      } as never),
    );
    expect(hiddenBubbleMarkup).not.toContain('hidden');

    const lineMarkup = renderToStaticMarkup(
      createElement(ProjectDividerNode, {
        data: {
          label: 'api',
          width: 500,
          showLabel: false,
          variant: 'line',
        },
      } as never),
    );
    expect(lineMarkup).toContain('border-dashed');

    const defaultDividerMarkup = renderToStaticMarkup(
      createElement(ProjectDividerNode, {
        data: {
          label: 'default',
        },
      } as never),
    );
    expect(defaultDividerMarkup).toContain('default');
  });

  it('renders left and right panels', () => {
    expect(
      renderToStaticMarkup(
        createElement(LeftPanelQueryKeys, {
          queryKeys: ['todo'],
          selectedQueryKey: 'todo',
          onSelectQueryKey: () => undefined,
        }),
      ),
    ).toContain('todo');

    expect(
      renderToStaticMarkup(
        createElement(LeftPanelRelatedFiles, {
          relatedFiles: [{ path: 'web/src/query.ts', workspace: 'web', depth: 1 }],
          fileQuery: '',
          selectedRelatedFilePath: 'web/src/query.ts',
          onSelectRelatedFile: () => undefined,
          showProjectDividers: false,
          collapsedDirectories: new Set<string>(),
          setCollapsedDirectories: () => undefined,
        }),
      ),
    ).toContain('web/src/query.ts');

    expect(
      renderToStaticMarkup(
        createElement(RightPanel, {
          selectedNode: null,
          explanation: null,
          onReveal: () => undefined,
          onRevealFile: () => undefined,
          onRevealCallsite: () => undefined,
        }),
      ),
    ).toContain('Select a node');

    expect(
      renderToStaticMarkup(
        createElement(RightPanel, {
          selectedNode: {
            id: 'file',
            kind: 'file',
            label: 'src/file.ts',
            file: '/workspace/src/file.ts',
            resolution: 'static',
            loc: { line: 1, column: 1 },
          },
          explanation: {
            summary: 'summary',
            files: [{ label: 'src/file.ts', file: '/workspace/src/file.ts' }],
            actions: [{ label: 'callsite', file: '/workspace/src/file.ts' }],
            declarations: [],
            queryKeys: ['todo'],
          },
          onReveal: () => undefined,
          onRevealFile: () => undefined,
          onRevealCallsite: () => undefined,
        }),
      ),
    ).toContain('Open in code');

    const declareDetailsMarkup = renderToStaticMarkup(
      createElement(RightPanel, {
        selectedNode: {
          id: 'declare',
          kind: 'action',
          label: 'declareTodos',
          resolution: 'static',
          metrics: { relation: 'declares', declaresDirectly: 1 },
        },
        explanation: {
          summary: 'declare summary',
          files: [{ label: 'virtual file' }],
          actions: [{ label: 'virtual callsite' }],
          declarations: [{ label: 'declared here', file: '/workspace/src/declare.ts', line: 4 }],
          queryKeys: Array.from({ length: 13 }, (_, index) => `todo-${index}`),
        },
        onReveal: () => undefined,
        onRevealFile: () => undefined,
        onRevealCallsite: () => undefined,
      }),
    );
    expect(declareDetailsMarkup).toContain('declare');
    expect(declareDetailsMarkup).toContain('virtual file');
    expect(declareDetailsMarkup).toContain('virtual callsite');
    expect(declareDetailsMarkup).toContain('Declared in');
    expect(declareDetailsMarkup).not.toContain('todo-12');

    expect(
      renderToStaticMarkup(
        createElement(RightPanel, {
          selectedNode: {
            id: 'query',
            kind: 'queryKey',
            label: 'todo',
            resolution: 'static',
          },
          explanation: null,
          onReveal: () => undefined,
          onRevealFile: () => undefined,
          onRevealCallsite: () => undefined,
        }),
      ),
    ).toContain('queryKey');

    expect(
      renderToStaticMarkup(
        createElement(ResizeDivider, {
          hiddenOnSmall: true,
          onPointerDown: () => undefined,
        }),
      ),
    ).toContain('cursor-col-resize');
  });

  it('renders empty and nested related-file states', () => {
    expect(
      renderToStaticMarkup(
        createElement(LeftPanelQueryKeys, {
          queryKeys: [],
          selectedQueryKey: null,
          onSelectQueryKey: () => undefined,
        }),
      ),
    ).toContain('No query keys in current filters');

    expect(
      renderToStaticMarkup(
        createElement(LeftPanelRelatedFiles, {
          relatedFiles: [],
          fileQuery: '',
          selectedRelatedFilePath: null,
          onSelectRelatedFile: () => undefined,
          showProjectDividers: false,
          collapsedDirectories: new Set<string>(),
          setCollapsedDirectories: () => undefined,
        }),
      ),
    ).toContain('No related files in current filters');

    const treeMarkup = renderToStaticMarkup(
      createElement(LeftPanelRelatedFiles, {
        relatedFiles: [
          { path: 'api/src/query.ts', workspace: 'api', depth: 1, impact: 2 },
          { path: 'web/src/query.ts', workspace: 'web', depth: 1, impact: 1 },
          { path: 'web/src/nested/file.ts', workspace: 'web', depth: 2, impact: 3 },
        ],
        fileQuery: '',
        selectedRelatedFilePath: 'web/src/query.ts',
        onSelectRelatedFile: () => undefined,
        showProjectDividers: true,
        collapsedDirectories: new Set<string>(),
        setCollapsedDirectories: () => undefined,
      }),
    );

    expect(treeMarkup).toContain('api/src/query.ts');
    expect(treeMarkup).toContain('web/src/query.ts');
    expect(treeMarkup).toContain('web/src/nested/file.ts');
    expect(treeMarkup).toContain('border-t border-zinc-300/70');
  });
});
