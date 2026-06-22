import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { collectFiles, runStaticAnalysis } from '../analyzer';
import type { ScanScope } from '../../../shared/contracts';

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rqv-analyzer-'));
  await mkdir(path.join(root, 'src'), { recursive: true });

  await writeFile(path.join(root, 'src', 'keys.ts'), ["export const todoKey = ['todos'] as const;"].join('\n'));

  await writeFile(
    path.join(root, 'src', 'app.ts'),
    [
      "import { useQuery, useQueryClient } from '@tanstack/react-query';",
      "import { todoKey } from '../keys';",
      'const client = useQueryClient();',
      'export function run() {',
      '  useQuery({ queryKey: todoKey, queryFn: () => null });',
      '  client.invalidateQueries({ queryKey: todoKey });',
      '  return null;',
      '}',
    ].join('\n'),
  );

  // A file that fails to parse, to exercise the parseErrors branch.
  await writeFile(path.join(root, 'src', 'broken.ts'), 'export const = ;');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'rqv-analyzer' }));

  return root;
}

const scope: ScanScope = {
  folders: [],
  includeGlob: '**/*.{ts,tsx}',
  excludeGlob: '**/node_modules/**',
  maxFileSizeKB: 512,
  useGitIgnore: false,
};

describe('core/analysis/analyzer', () => {
  it('collects files within the workspace', async () => {
    const root = await makeWorkspace();
    const files = await collectFiles(root, scope);
    expect(files.some((f) => f.endsWith('app.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('keys.ts'))).toBe(true);
  });

  it('runs static analysis, producing records and capturing parse errors', async () => {
    const root = await makeWorkspace();
    const result = await runStaticAnalysis(root, scope);

    expect(result.filesScanned).toBeGreaterThanOrEqual(3);
    expect(result.scannedFiles.some((f) => f.endsWith('app.ts'))).toBe(true);
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.parseErrors.some((e) => e.file.endsWith('broken.ts'))).toBe(true);
  });
});
