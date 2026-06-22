import { describe, expect, it, vi } from 'vitest';

import type { WebviewPayload } from '../../../shared/contracts';
import { createGraph, createGraphNode } from '../../../testing/fixtures';

vi.mock('vscode', async () => await import('../../../testing/vscode'));

import { RqvActivityViewProvider } from '../activityView';

describe('extension/views/activityView', () => {
  it('builds activity children before and after a scan', async () => {
    const provider = new RqvActivityViewProvider();
    const initialChildren = (await provider.getChildren()) ?? [];

    expect(initialChildren.map((item) => item.label)).toEqual([
      'Scan Now',
      'Scan With Scope',
      'Open Graph Panel',
      'No scan result yet',
    ]);

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
            id: 'file-api',
            kind: 'file',
            label: 'api/src/query.ts',
            file: '/workspace/api/src/query.ts',
            resolution: 'static',
            metrics: { affectedKeys: 1, projectScope: 'api:packages/api' },
          }),
          createGraphNode({
            id: 'file-api-a',
            kind: 'file',
            label: 'api/src/a.ts',
            file: '/workspace/api/src/a.ts',
            resolution: 'static',
            metrics: { affectedKeys: 1, projectScope: 'api:packages/api' },
          }),
        ],
        edges: [],
      }),
      scannedFiles: [
        { workspace: 'web', path: 'web/src/query.ts', depth: 1 },
        { workspace: 'api', path: 'api/src/query.ts', depth: 1 },
        { workspace: 'api', path: 'api/src/a.ts', depth: 1 },
      ],
      scopeLabel: 'All files',
      layout: { direction: 'LR', engine: 'dagre', verticalSpacing: 30, horizontalSpacing: 500 },
    } satisfies WebviewPayload;

    provider.updateFromPayload(payload);
    const scannedChildren = (await provider.getChildren()) ?? [];

    expect(scannedChildren.map((item) => item.label)).toEqual([
      'Scan Now',
      'Scan With Scope',
      'Open Graph Panel',
      'Parse Errors',
      'Related Files',
    ]);

    const relatedFilesRoot = scannedChildren[4];
    expect(provider.getTreeItem(relatedFilesRoot)).toBe(relatedFilesRoot);
    expect(relatedFilesRoot?.tooltip).toContain('All files');
    const relatedChildren = (await provider.getChildren(relatedFilesRoot)) ?? [];
    expect(relatedChildren.map((item) => item.label)).toEqual(['api/packages/api', 'web/apps/web']);
    const webProject = relatedChildren.find((item) => item.label === 'web/apps/web');
    const webProjectChildren = (await provider.getChildren(webProject)) ?? [];
    const srcDir = webProjectChildren.find((item) => item.label === 'src');
    const srcChildren = srcDir ? ((await provider.getChildren(srcDir)) ?? []) : [];
    const fileNode = srcChildren.find((item) => item.label === 'query.ts');
    expect(fileNode?.command).toMatchObject({
      command: 'rqv.revealInCode',
      arguments: [{ file: '/workspace/web/src/query.ts', line: 1, column: 1 }],
    });
  });

  it('shows parse error warnings and falls back to an empty related files root', async () => {
    const provider = new RqvActivityViewProvider();
    provider.updateFromPayload({
      graph: createGraph({
        nodes: [],
        edges: [],
        summary: { files: 0, actions: 0, queryKeys: 0, parseErrors: 1 },
        parseErrors: [{ file: 'src/broken.ts', message: 'parse failed' }],
      }),
      scannedFiles: [],
      scopeLabel: 'Scoped scan',
      layout: { direction: 'LR', engine: 'dagre', verticalSpacing: 30, horizontalSpacing: 500 },
    });

    const scannedChildren = (await provider.getChildren()) ?? [];
    const parseErrorsNode = scannedChildren[3];
    expect(parseErrorsNode?.iconPath).toMatchObject({ id: 'warning' });

    const fallbackProvider = new RqvActivityViewProvider();
    (fallbackProvider as unknown as { lastScan: { parseErrors: number; relatedFilesTree: [] } }).lastScan = {
      parseErrors: 0,
      relatedFilesTree: [],
    };

    const fallbackChildren = (await fallbackProvider.getChildren()) ?? [];
    const relatedFilesNode = fallbackChildren[4];
    expect(relatedFilesNode?.id).toBe('rqv:related-files-empty');
    expect(relatedFilesNode?.description).toBe('0');
  });

  it('covers sparse related file metadata', async () => {
    const { RqvActivityViewProvider } = await import('../activityView');
    const provider = new RqvActivityViewProvider();
    provider.updateFromPayload({
      graph: createGraph({
        nodes: [
          createGraphNode({
            id: 'empty-label',
            kind: 'file',
            label: '',
            resolution: 'static',
          }),
          createGraphNode({
            id: 'relative-file',
            kind: 'file',
            label: 'src/query.ts',
            resolution: 'static',
          }),
          createGraphNode({
            id: 'no-absolute-path',
            kind: 'file',
            label: 'src/no-file.ts',
            resolution: 'static',
            metrics: { affectedKeys: 3 },
          }),
        ],
        edges: [],
        summary: { files: 3, actions: 0, queryKeys: 0, parseErrors: 0 },
      }),
      scannedFiles: [],
      scopeLabel: 'Sparse scan',
      layout: { direction: 'LR', engine: 'dagre', verticalSpacing: 30, horizontalSpacing: 500 },
    });

    const roots = (await provider.getChildren()) ?? [];
    const parseErrorsNode = roots.find((item) => item.id === 'rqv:parse-errors');
    expect(parseErrorsNode?.iconPath).toMatchObject({ id: 'check' });
    const relatedFilesRoot = roots.find((item) => item.id === 'rqv:related-files-root');
    const relatedChildren = (await provider.getChildren(relatedFilesRoot)) ?? [];
    expect(relatedChildren.some((item) => item.label === 'workspace')).toBe(true);

    const workspaceNode = relatedChildren.find((item) => item.label === 'workspace');
    const workspaceChildren = (await provider.getChildren(workspaceNode)) ?? [];
    const emptyFile = workspaceChildren.find((item) => item.id === 'rqv:file:');
    expect(emptyFile?.command).toBeUndefined();
  });
});
