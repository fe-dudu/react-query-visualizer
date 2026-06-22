import { describe, expect, it } from 'vitest';

import { buildRelatedFiles } from '../relatedFiles';
import { createGraph, createGraphNode, createScannedFile } from '../../../testing/fixtures';

describe('webview/utils/relatedFiles', () => {
  it('builds sorted related files with projects and relative paths', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-1',
          kind: 'file',
          label: '/repo/apps/web/src/file.ts',
          file: '/repo/apps/web/src/file.ts',
          resolution: 'static',
          metrics: { affectedKeys: 3, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'file-2',
          kind: 'file',
          label: '/repo/packages/core/index.ts',
          file: '/repo/packages/core/index.ts',
          resolution: 'static',
          metrics: { affectedKeys: 1 },
        }),
      ],
      edges: [],
    });

    const related = buildRelatedFiles(
      [
        createScannedFile({
          path: '/repo/apps/web/src/file.ts',
          workspace: '/repo',
          depth: 3,
          project: 'web/app',
          projectRelativePath: 'src/file.ts',
          impact: 3,
        }),
        createScannedFile({
          path: '/repo/packages/core/index.ts',
          workspace: '/repo',
          depth: 1,
          project: 'core',
          projectRelativePath: 'index.ts',
          impact: 1,
        }),
      ],
      graph,
    );

    expect(related).toHaveLength(2);
    expect(related.map((file) => file.path)).toEqual(['/repo/apps/web/src/file.ts', '/repo/packages/core/index.ts']);
    expect(related[0]?.projectRelativePath).toBe('src/file.ts');
  });

  it('uses multi-workspace project prefixes and falls back for unmatched files', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-a',
          kind: 'file',
          label: 'web/src/file.ts',
          file: '/repo/web/src/file.ts',
          resolution: 'static',
          metrics: { affectedKeys: 1, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'file-b',
          kind: 'file',
          label: 'packages/core/index.ts',
          file: '/repo/packages/core/index.ts',
          resolution: 'static',
          metrics: { affectedKeys: 2 },
        }),
        createGraphNode({
          id: 'file-c',
          kind: 'file',
          label: '/tmp/outside.ts',
          file: '/tmp/outside.ts',
          resolution: 'static',
          metrics: { affectedKeys: 0 },
        }),
        createGraphNode({
          id: 'file-d',
          kind: 'file',
          label: '/tmp/alpha.ts',
          file: '/tmp/alpha.ts',
          resolution: 'static',
        }),
        createGraphNode({
          id: 'file-e',
          kind: 'file',
          label: '/tmp/shared-b.ts',
          file: '/tmp/shared-b.ts',
          resolution: 'static',
          metrics: { affectedKeys: 5, projectScope: 'tmp:shared' },
        }),
        createGraphNode({
          id: 'file-f',
          kind: 'file',
          label: '/tmp/shared-a.ts',
          file: '/tmp/shared-a.ts',
          resolution: 'static',
          metrics: { affectedKeys: 5, projectScope: 'tmp:shared' },
        }),
        createGraphNode({
          id: 'file-g',
          kind: 'file',
          label: '/tmp/shared-low.ts',
          file: '/tmp/shared-low.ts',
          resolution: 'static',
          metrics: { affectedKeys: 1, projectScope: 'tmp:shared' },
        }),
      ],
      edges: [],
    });

    const related = buildRelatedFiles(
      [
        createScannedFile({
          path: '/repo/web/src/file.ts',
          workspace: 'web',
          depth: 1,
          impact: 1,
        }),
        createScannedFile({
          path: '/repo/packages/core/index.ts',
          workspace: 'core',
          depth: 2,
          impact: 2,
        }),
      ],
      graph,
    );

    expect(related.map((file) => file.project)).toEqual([
      'apps/web',
      'packages/core',
      'shared',
      'shared',
      'shared',
      'tmp/alpha.ts',
      'tmp/outside.ts',
    ]);
    expect(related.map((file) => file.workspace)).toEqual(['', '', '', '', '', '', '']);
    expect(related.map((file) => file.path).slice(2, 5)).toEqual([
      '/tmp/shared-a.ts',
      '/tmp/shared-b.ts',
      '/tmp/shared-low.ts',
    ]);
    expect(related[5]?.impact).toBe(0);
    expect(related[5]?.depth).toBeGreaterThanOrEqual(0);
  });

  it('prefixes projects by workspace when scanned files match visible nodes', () => {
    const graph = createGraph({
      nodes: [
        createGraphNode({
          id: 'file-a',
          kind: 'file',
          label: 'web/src/file.ts',
          file: '/repo/web/src/file.ts',
          resolution: 'static',
          metrics: { affectedKeys: 1, projectScope: 'web:apps/web' },
        }),
        createGraphNode({
          id: 'file-b',
          kind: 'file',
          label: 'packages/core/index.ts',
          file: '/repo/packages/core/index.ts',
          resolution: 'static',
          metrics: { affectedKeys: 2 },
        }),
      ],
      edges: [],
    });

    const related = buildRelatedFiles(
      [
        createScannedFile({
          path: 'web/src/file.ts',
          workspace: 'web',
          depth: 1,
          impact: 1,
        }),
        createScannedFile({
          path: 'packages/core/index.ts',
          workspace: 'core',
          depth: 2,
          impact: 2,
        }),
      ],
      graph,
    );

    expect(related.map((file) => file.workspace)).toEqual(['core', 'web']);
    expect(related.map((file) => file.project)).toEqual(['core/packages/core', 'web/apps/web']);
    expect(related.map((file) => file.projectRelativePath)).toEqual(['index.ts', 'src/file.ts']);
  });
});
