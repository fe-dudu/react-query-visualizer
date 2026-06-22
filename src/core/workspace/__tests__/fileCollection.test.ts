import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectFiles } from '../fileCollection';

afterEach(() => {
  vi.doUnmock('fast-glob');
  vi.resetModules();
});

describe('core/workspace/fileCollection', () => {
  it('collects files with gitignore, excludes, and size limits', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-files-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 1;');
    await writeFile(path.join(root, 'src', 'types.d.ts'), 'export declare const types: string;');
    await writeFile(path.join(root, 'src', 'ignored.ts'), 'export const ignored = 1;');
    await writeFile(path.join(root, 'src', 'big.ts'), 'x'.repeat(2048));
    await writeFile(path.join(root, '.gitignore'), '**/ignored.ts\n');

    const files = await collectFiles(root, {
      folders: ['.'],
      includeGlob: '**/*.ts',
      excludeGlob: '**/node_modules/**',
      useGitIgnore: true,
      maxFileSizeKB: 1,
    });

    expect(files).toEqual([path.join(root, 'src', 'a.ts')]);
  });

  it('handles nested gitignore rules, external folders, and disabled gitignore', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-files-'));
    const external = await mkdtemp(path.join(os.tmpdir(), 'rqv-external-'));
    await mkdir(path.join(root, 'src', 'generated'), { recursive: true });
    await mkdir(path.join(external, 'shared'), { recursive: true });
    await writeFile(path.join(root, 'src', 'keep.ts'), 'export const keep = 1;');
    await writeFile(path.join(root, 'src', 'ignored-by-nested.ts'), 'export const ignored = 1;');
    await writeFile(path.join(root, 'src', 'generated', 'skip.ts'), 'export const skip = 1;');
    await writeFile(
      path.join(root, 'src', '.gitignore'),
      '/ignored-by-nested.ts\ngenerated/\n/\n!keep.ts\n# comment\n',
    );
    await writeFile(path.join(external, 'shared', 'outside.ts'), 'export const outside = 1;');

    const withGitIgnore = await collectFiles(root, {
      folders: ['src', path.join(external, 'shared')],
      includeGlob: '**/*.ts',
      excludeGlob: '',
      useGitIgnore: true,
      maxFileSizeKB: 8,
    });
    expect(withGitIgnore.sort()).toEqual([
      path.join(external, 'shared', 'outside.ts'),
      path.join(root, 'src', 'generated', 'skip.ts'),
      path.join(root, 'src', 'ignored-by-nested.ts'),
      path.join(root, 'src', 'keep.ts'),
    ]);

    const withoutGitIgnore = await collectFiles(root, {
      folders: ['src'],
      includeGlob: '**/*.ts',
      excludeGlob: '**/generated/**',
      useGitIgnore: false,
      maxFileSizeKB: 8,
    });
    expect(withoutGitIgnore.sort()).toEqual([
      path.join(root, 'src', 'ignored-by-nested.ts'),
      path.join(root, 'src', 'keep.ts'),
    ]);

    const defaultFolder = await collectFiles(root, {
      folders: [],
      includeGlob: 'src/keep.ts',
      excludeGlob: '',
      useGitIgnore: false,
      maxFileSizeKB: 8,
    });
    expect(defaultFolder).toEqual([path.join(root, 'src', 'keep.ts')]);

    const emptyFolder = await collectFiles(root, {
      folders: [''],
      includeGlob: 'src/keep.ts',
      excludeGlob: '',
      useGitIgnore: false,
      maxFileSizeKB: 8,
    });
    expect(emptyFolder).toEqual([path.join(root, 'src', 'keep.ts')]);
  });

  it('skips files that disappear before stat', async () => {
    vi.doMock('fast-glob', () => ({
      default: vi.fn(async () => ['/tmp/rqv-missing-file.ts']),
    }));
    vi.resetModules();
    const { collectFiles } = await import('../fileCollection');

    await expect(
      collectFiles('/tmp', {
        folders: ['.'],
        includeGlob: '**/*.ts',
        excludeGlob: '',
        useGitIgnore: false,
        maxFileSizeKB: 8,
      }),
    ).resolves.toEqual([]);
  });

  it('ignores gitignore files that disappear before reading', async () => {
    const glob = vi.fn(async (patterns: string[]) =>
      patterns[0] === '**/.gitignore' ? ['/tmp/rqv-missing/.gitignore'] : [],
    );
    vi.doMock('fast-glob', () => ({
      default: glob,
    }));
    vi.resetModules();
    const { collectFiles } = await import('../fileCollection');

    await expect(
      collectFiles('/tmp', {
        folders: ['.'],
        includeGlob: '**/*.ts',
        excludeGlob: '',
        useGitIgnore: true,
        maxFileSizeKB: 8,
      }),
    ).resolves.toEqual([]);
  });
});
