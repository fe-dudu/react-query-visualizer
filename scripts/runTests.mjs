import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const testsDir = path.join(repoRoot, 'tests');
const outDir = await mkdtemp(path.join(os.tmpdir(), 'rqv-tests-'));

async function listTestFiles() {
  const entries = await readdir(testsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.ts'))
    .map((entry) => path.join(testsDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function runNodeTest(compiledFiles) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', ...compiledFiles], {
      cwd: repoRoot,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Tests failed with exit code ${code ?? 'unknown'}`));
    });
  });
}

const testFiles = await listTestFiles();
if (testFiles.length === 0) {
  process.exit(0);
}

try {
  const compiledFiles = [];
  for (const testFile of testFiles) {
    const outputFile = path.join(outDir, `${path.basename(testFile, '.ts')}.cjs`);
    await build({
      entryPoints: [testFile],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node24',
      outfile: outputFile,
      sourcemap: 'inline',
    });
    compiledFiles.push(outputFile);
  }

  await runNodeTest(compiledFiles);
} finally {
  await rm(outDir, { recursive: true, force: true });
}
