import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import fg from 'fast-glob';

import type { ScanScope } from '../../types';
import { parseGlobPatterns } from '../glob';

function normalizeFolderInput(input: string): string {
  if (!input || input === '.') {
    return '.';
  }

  return input.split(path.sep).join('/');
}

function isWithinSizeLimit(statSize: number, maxKB: number): boolean {
  return statSize <= maxKB * 1024;
}

function normalizeGitIgnoreRule(line: string): string {
  let pattern = line.replace(/\\/g, '/').trim();
  if (pattern.startsWith('/')) {
    pattern = pattern.slice(1);
  }

  if (pattern.endsWith('/')) {
    pattern = `${pattern}**`;
  }

  return pattern;
}

async function readGitIgnorePatterns(rootPath: string, excludePatterns: string[]): Promise<string[]> {
  const ignoreFiles = await fg(['**/.gitignore'], {
    cwd: rootPath,
    absolute: true,
    onlyFiles: true,
    dot: true,
    unique: true,
    suppressErrors: true,
    ignore: excludePatterns,
  });

  const patterns: string[] = [];

  for (const file of ignoreFiles) {
    let content: string;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }

    const baseDir = path.relative(rootPath, path.dirname(file)).split(path.sep).join('/');

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('!')) {
        continue;
      }

      const normalized = normalizeGitIgnoreRule(line);
      if (!normalized) {
        continue;
      }

      if (!baseDir || baseDir === '.') {
        patterns.push(normalized);
      } else {
        patterns.push(`${baseDir}/${normalized}`);
      }
    }
  }

  return patterns;
}

function isUnderRoot(rootPath: string, cwd: string): boolean {
  const relative = path.relative(rootPath, cwd);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function collectFiles(rootPath: string, scope: ScanScope): Promise<string[]> {
  const includePatterns = parseGlobPatterns(scope.includeGlob);
  const excludePatterns = parseGlobPatterns(scope.excludeGlob);
  const gitIgnorePatterns = scope.useGitIgnore ? await readGitIgnorePatterns(rootPath, excludePatterns) : [];
  const folders = scope.folders.length > 0 ? scope.folders : ['.'];

  const fileSet = new Set<string>();

  await Promise.all(
    folders.map(async (folder) => {
      const normalizedFolder = normalizeFolderInput(folder);
      const cwd = path.isAbsolute(normalizedFolder) ? normalizedFolder : path.resolve(rootPath, normalizedFolder);
      const scopedIgnores = isUnderRoot(rootPath, cwd) ? [...excludePatterns, ...gitIgnorePatterns] : excludePatterns;

      const matches: string[] = await fg(includePatterns, {
        cwd,
        absolute: true,
        onlyFiles: true,
        dot: false,
        suppressErrors: true,
        unique: true,
        followSymbolicLinks: false,
        ignore: scopedIgnores,
      });

      for (const file of matches) {
        fileSet.add(path.resolve(file));
      }
    }),
  );

  const allFiles = [...fileSet];
  const stats = await Promise.all(
    allFiles.map(async (file) => {
      try {
        const stat = await fs.stat(file);
        return { file, include: stat.isFile() && isWithinSizeLimit(stat.size, scope.maxFileSizeKB) };
      } catch {
        return { file, include: false };
      }
    }),
  );

  return stats.filter((item) => item.include).map((item) => item.file);
}
