import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { mapParseErrors, normalizeFilePath, projectScopeForFile, toDisplayPath, toPosix } from '../paths';

describe('core/graph/paths', () => {
  it('normalizes display paths and scopes files by package boundaries', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-paths-'));
    await writeFile(path.join(root, 'package.json'), '{}');
    await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'src', 'nested', 'package.json'), '{}');

    const roots = [
      { name: 'workspace', path: root },
      { name: 'pkg', path: path.join(root, 'src') },
    ];
    const scopeCache = new Map<string, string>();
    const packageJsonCache = new Map<string, boolean>();
    const filePath = path.join(root, 'src', 'nested', 'file.ts');

    expect(toPosix(path.join('a', 'b'))).toBe('a/b');
    expect(normalizeFilePath(filePath)).toBe(path.resolve(filePath).split(path.sep).join('/'));
    expect(toDisplayPath(roots, filePath)).toBe('pkg/nested/file.ts');
    expect(
      toDisplayPath(
        [
          { name: 'pkg', path: path.join(root, 'src') },
          { name: 'workspace', path: root },
        ],
        filePath,
      ),
    ).toBe('pkg/nested/file.ts');
    expect(projectScopeForFile(roots, filePath, scopeCache, packageJsonCache)).toBe('pkg:nested');

    const fallbackScopeCache = new Map<string, string>();
    const fallbackPackageJsonCache = new Map<string, boolean>();
    expect(projectScopeForFile([], filePath, fallbackScopeCache, fallbackPackageJsonCache)).toMatch(/^workspace:/);
    expect(projectScopeForFile([], path.parse(root).root, new Map(), new Map())).toBe('workspace:*');

    const mapped = mapParseErrors(roots, [{ file: filePath, message: 'bad' }]);
    expect(mapped[0]).toEqual({ file: 'pkg/nested/file.ts', message: 'bad' });

    expect(toDisplayPath([{ name: 'workspace', path: root }], root)).toBe('.');
    expect(toDisplayPath(roots, path.join(root, 'src'))).toBe('pkg/.');
    expect(toDisplayPath(roots, path.join(root, '..', 'outside.ts'))).toBe(
      path.resolve(root, '..', 'outside.ts').split(path.sep).join('/'),
    );
    expect(projectScopeForFile(roots, root, scopeCache, packageJsonCache)).toBe('workspace:*');
    expect(projectScopeForFile(roots, path.join(root, 'loose.ts'), scopeCache, new Map())).toBe('workspace:.');
    expect(projectScopeForFile(roots, filePath, scopeCache, packageJsonCache)).toBe('pkg:nested');
  });
});
