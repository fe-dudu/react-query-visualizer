import { describe, expect, it, vi } from 'vitest';

import { buildFileTree, collectDirectoryPaths, directoryImpact, displayFileName } from '../leftPanelTree';
import { createScannedFile } from '../../../testing/fixtures';
import * as sharedPath from '../../../shared/path';

describe('webview/utils/leftPanelTree', () => {
  it('builds a nested file tree with impact totals', () => {
    const tree = buildFileTree([
      createScannedFile({
        path: 'apps/web/src/app.ts',
        workspace: 'web',
        depth: 3,
        project: 'web/app',
        projectRelativePath: 'src/app.ts',
        impact: 2,
      }),
      createScannedFile({
        path: 'apps/web/src/routes/home.ts',
        workspace: 'web',
        depth: 4,
        project: 'web/app',
        projectRelativePath: 'src/routes/home.ts',
        impact: 5,
      }),
      createScannedFile({
        path: 'packages/core/index.ts',
        workspace: 'core',
        depth: 1,
        project: 'core',
        projectRelativePath: 'index.ts',
        impact: 1,
      }),
      createScannedFile({
        path: 'workspace-only.ts',
        workspace: 'workspace-name',
        depth: 0,
        project: undefined,
        projectRelativePath: 'workspace-only.ts',
        impact: undefined,
      }),
      createScannedFile({
        path: 'empty-relative.ts',
        workspace: '',
        depth: 0,
        project: '',
        projectRelativePath: '',
        impact: 3,
      }),
      createScannedFile({
        path: 'double-slash.ts',
        workspace: '',
        depth: 0,
        project: 'double',
        projectRelativePath: 'src//double-slash.ts',
        impact: 1,
      }),
    ]);

    const webAppDir = tree.directories.get('web/app');
    if (!webAppDir) {
      throw new Error('Missing web/app directory');
    }

    expect(tree.directories.get('web/app')?.impact).toBe(7);
    expect(tree.directories.get('core')?.files[0]?.path).toBe('packages/core/index.ts');
    expect(tree.directories.get('workspace-name')?.files[0]?.path).toBe('workspace-only.ts');
    expect(tree.directories.get('workspace')?.files).toHaveLength(0);
    expect(tree.directories.get('double')?.directories.get('src')?.files[0]?.path).toBe('double-slash.ts');
    expect(directoryImpact(webAppDir)).toBe(7);
    expect(displayFileName('a/b/c.ts')).toBe('c.ts');
    expect(displayFileName('')).toBe('');
    expect([...collectDirectoryPaths(tree)]).toEqual(expect.arrayContaining(['web/app/src', 'web/app/src/routes']));
  });

  it('skips blank path segments when the path normalizer returns them', () => {
    const normalizeSpy = vi.spyOn(sharedPath, 'normalizePathSegments').mockReturnValue(['web', '', 'src', 'file.ts']);

    try {
      const tree = buildFileTree([
        createScannedFile({
          path: 'web//src/file.ts',
          workspace: 'web',
          depth: 3,
          project: 'web',
          projectRelativePath: 'web//src/file.ts',
          impact: 1,
        }),
      ]);

      expect(tree.directories.get('web')?.directories.get('web')?.directories.get('src')?.files[0]?.path).toBe(
        'web//src/file.ts',
      );
    } finally {
      normalizeSpy.mockRestore();
    }
  });
});
