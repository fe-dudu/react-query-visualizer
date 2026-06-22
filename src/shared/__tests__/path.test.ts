import { describe, expect, it } from 'vitest';

import {
  depthFromPath,
  inferProjectFromPath,
  makeProjectRelativePath,
  normalizePathSegments,
  parseProjectScope,
  projectLabelFromScope,
  stripWorkspacePrefix,
} from '../path';

describe('shared/path', () => {
  it('normalizes and measures paths', () => {
    expect(normalizePathSegments('a//b/c/')).toEqual(['a', 'b', 'c']);
    expect(depthFromPath('file.ts')).toBe(0);
    expect(depthFromPath('a/b/c.ts')).toBe(2);
  });

  it('strips workspace prefixes and infers projects', () => {
    expect(stripWorkspacePrefix('/repo/apps/web/src/file.ts', '')).toBe('/repo/apps/web/src/file.ts');
    expect(stripWorkspacePrefix('/repo/apps/web/src/file.ts', '/repo')).toBe('apps/web/src/file.ts');
    expect(stripWorkspacePrefix('/outside/file.ts', '/repo')).toBe('/outside/file.ts');

    expect(inferProjectFromPath('/repo/apps/web/src/file.ts', '/repo')).toBe('apps/web');
    expect(inferProjectFromPath('/repo/file.ts', '/repo')).toBe('file.ts');
    expect(inferProjectFromPath('/repo/', '/repo')).toBe('/repo');
    expect(inferProjectFromPath('', '')).toBe('workspace');
  });

  it('parses and labels project scopes', () => {
    expect(parseProjectScope(null)).toBeNull();
    expect(parseProjectScope('')).toBeNull();
    expect(parseProjectScope('core')).toEqual({ root: '', project: 'core' });
    expect(parseProjectScope('app:')).toEqual({ root: 'app', project: 'app' });
    expect(parseProjectScope('app:*')).toEqual({ root: 'app', project: 'app' });
    expect(parseProjectScope('app:packages/core')).toEqual({ root: 'app', project: 'packages/core' });
    expect(projectLabelFromScope('app:packages/core')).toBe('app/packages/core');
    expect(projectLabelFromScope('app:*')).toBe('app');
    expect(projectLabelFromScope('core')).toBe('core');
    expect(projectLabelFromScope(null)).toBeNull();
    expect(parseProjectScope(' app : . ')).toEqual({ root: 'app', project: 'app' });
    expect(parseProjectScope(' : shared ')).toEqual({ root: '', project: 'shared' });
    expect(parseProjectScope(':')).toEqual({ root: '', project: 'workspace' });
    expect(projectLabelFromScope(':')).toBe('workspace');
  });

  it('derives project-relative paths', () => {
    expect(makeProjectRelativePath('', '/repo', 'apps/web')).toBe('');
    expect(makeProjectRelativePath('/repo/apps/web/src/file.ts', '/repo', 'apps/web')).toBe('src/file.ts');
    expect(makeProjectRelativePath('/repo/apps/web/src/file.ts', '/repo', 'packages/core')).toBe(
      'apps/web/src/file.ts',
    );
    expect(makeProjectRelativePath('/repo/file.ts', '/repo', 'repo')).toBe('file.ts');
    expect(makeProjectRelativePath('/repo', '/repo', 'repo')).toBe('repo');
    expect(makeProjectRelativePath('/repo', '/repo', '')).toBe('/repo');
    expect(makeProjectRelativePath('/outside/file.ts', '/repo', 'repo')).toBe('/outside/file.ts');
  });
});
