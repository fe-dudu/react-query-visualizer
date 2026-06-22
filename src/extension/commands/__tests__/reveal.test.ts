import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import * as vscode from '../../../testing/vscode';

vi.mock('vscode', async () => await import('../../../testing/vscode'));

describe('extension/commands/reveal', () => {
  it('opens a relative file inside the workspace', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'rqv-reveal-'));
    await mkdir(join(workspaceDir, 'src'), { recursive: true });
    const filePath = join(workspaceDir, 'src/file.ts');
    await writeFile(filePath, 'export const value = 1;\n');
    vscode.workspace.workspaceFolders = [{ name: 'workspace', uri: { fsPath: workspaceDir } }];

    const openTextDocument = vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({} as never);
    const showTextDocument = vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue({
      selection: null,
      revealRange: vi.fn(),
    } as never);

    const { revealInCode } = await import('../reveal');
    await revealInCode({ file: 'src/file.ts', line: 2, column: 3 });

    expect(openTextDocument).toHaveBeenCalledWith(filePath);
    expect(showTextDocument).toHaveBeenCalled();

    await revealInCode({ file: filePath });
    expect(openTextDocument).toHaveBeenCalledWith(filePath);

    await revealInCode(undefined);
  });

  it('warns when the target file cannot be located', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'rqv-reveal-missing-'));
    vscode.workspace.workspaceFolders = [{ name: 'workspace', uri: { fsPath: workspaceDir } }];
    const warning = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

    const { revealInCode } = await import('../reveal');
    await revealInCode({ file: 'missing.ts' });

    expect(warning).toHaveBeenCalledWith('React Query Visualizer: Could not locate file: missing.ts');
  });
});
