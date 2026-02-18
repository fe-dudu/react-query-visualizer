import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { getWorkspaceFolders } from './workspace';

async function pathExists(inputPath: string): Promise<boolean> {
  try {
    await fs.access(inputPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveFilePath(input: string, workspaces: vscode.WorkspaceFolder[]): Promise<string | undefined> {
  if (path.isAbsolute(input)) {
    return input;
  }

  for (const workspace of workspaces) {
    const candidate = path.resolve(workspace.uri.fsPath, input);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export async function revealInCode(args: { file?: string; line?: number; column?: number } | undefined): Promise<void> {
  if (!args?.file) {
    return;
  }

  const workspaces = getWorkspaceFolders();
  const fullPath = await resolveFilePath(args.file, workspaces);
  if (!fullPath) {
    vscode.window.showWarningMessage(`React Query Visualizer: Could not locate file: ${args.file}`);
    return;
  }

  const doc = await vscode.workspace.openTextDocument(fullPath);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });

  const line = Math.max(0, (args.line ?? 1) - 1);
  const column = Math.max(0, (args.column ?? 1) - 1);
  const pos = new vscode.Position(line, column);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}
