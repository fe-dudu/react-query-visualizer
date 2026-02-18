import * as path from 'node:path';
import * as vscode from 'vscode';

import { getWorkspaceFolders, scopeForWorkspace } from './workspace';
import type { RqvActivityViewProvider } from '../activityView';
import { runStaticAnalysis } from '../core/analyzer';
import { getLayoutConfig, persistScanScope } from '../core/config';
import { type GraphRoot, buildGraph } from '../core/graphBuilder';
import { scopeToLabel } from '../core/scope';
import { GraphPanel } from '../graphPanel';
import type { AnalysisResult, GraphData, ScanScope, ScannedFile, WebviewPayload } from '../types';

export interface ScanRunResult {
  payload: WebviewPayload;
  scannedWorkspaces: string[];
}

interface ScanAndPublishOptions {
  context: vscode.ExtensionContext;
  scope: ScanScope;
  persistScopeFlag: boolean;
  activityViewProvider?: RqvActivityViewProvider;
  onPayloadUpdated: (payload: WebviewPayload) => void;
}

function mergeAnalysis(results: AnalysisResult[]): AnalysisResult {
  return results.reduce<AnalysisResult>(
    (acc, current) => {
      acc.records.push(...current.records);
      acc.scannedFiles.push(...current.scannedFiles);
      acc.parseErrors.push(...current.parseErrors);
      acc.filesScanned += current.filesScanned;
      return acc;
    },
    {
      records: [],
      scannedFiles: [],
      parseErrors: [],
      filesScanned: 0,
    },
  );
}

function toNormalizedPath(inputPath: string): string {
  return inputPath.split(path.sep).join('/');
}

function normalizeRelativePath(workspaceRoot: string, absolutePath: string): string {
  const relative = toNormalizedPath(path.relative(workspaceRoot, absolutePath));
  if (!relative || relative === '.') {
    return path.basename(absolutePath);
  }

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return toNormalizedPath(absolutePath);
  }

  return relative;
}

function computeDepth(relativePath: string): number {
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return 0;
  }

  return parts.length - 1;
}

function buildScannedFiles(
  targets: Array<{ workspace: vscode.WorkspaceFolder; scoped: ScanScope }>,
  analyses: AnalysisResult[],
): ScannedFile[] {
  const multiRoot = targets.length > 1;
  const scannedFiles: ScannedFile[] = [];

  analyses.forEach((analysis, index) => {
    const target = targets[index];
    if (!target) {
      return;
    }

    const workspaceName = target.workspace.name;
    analysis.scannedFiles.forEach((absolutePath) => {
      const relativePath = normalizeRelativePath(target.workspace.uri.fsPath, absolutePath);
      const depth = computeDepth(relativePath);
      scannedFiles.push({
        workspace: workspaceName,
        path: multiRoot ? `${workspaceName}/${relativePath}` : relativePath,
        depth,
      });
    });
  });

  scannedFiles.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  return scannedFiles;
}

export async function runScan(workspaces: vscode.WorkspaceFolder[], scope: ScanScope): Promise<ScanRunResult> {
  const targets = workspaces
    .map((workspace) => ({
      workspace,
      scoped: scopeForWorkspace(scope, workspace),
    }))
    .filter((value): value is { workspace: vscode.WorkspaceFolder; scoped: ScanScope } => Boolean(value.scoped));

  if (targets.length === 0) {
    throw new Error('Selected folders are outside all opened workspaces.');
  }

  const analyses = await Promise.all(
    targets.map(({ workspace, scoped }) => runStaticAnalysis(workspace.uri.fsPath, scoped)),
  );

  const merged = mergeAnalysis(analyses);
  const roots: GraphRoot[] = targets.map(({ workspace }) => ({
    name: workspace.name,
    path: workspace.uri.fsPath,
  }));
  const scannedFiles = buildScannedFiles(targets, analyses);

  const graph: GraphData = buildGraph(roots, merged);
  const scannedWorkspaces = roots.map((root) => root.name);

  return {
    payload: {
      graph,
      scannedFiles,
      scopeLabel: `${scopeToLabel(scope)} | Workspaces: ${scannedWorkspaces.join(', ')}`,
      layout: getLayoutConfig(),
    },
    scannedWorkspaces,
  };
}

export async function scanAndPublish({
  context,
  scope,
  persistScopeFlag,
  activityViewProvider,
  onPayloadUpdated,
}: ScanAndPublishOptions): Promise<void> {
  const workspaces = getWorkspaceFolders();
  if (workspaces.length === 0) {
    vscode.window.showWarningMessage('React Query Visualizer: Open a workspace folder first.');
    return;
  }

  if (persistScopeFlag) {
    await persistScanScope(scope);
  }

  const panel = GraphPanel.createOrShow(context.extensionUri);

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'React Query Visualizer: Scanning React Query usage',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Collecting source files...' });
      const scanResult = await runScan(workspaces, scope);
      progress.report({ message: 'Building graph...' });
      return scanResult;
    },
  );

  onPayloadUpdated(result.payload);
  activityViewProvider?.updateFromPayload(result.payload);
  panel.update(result.payload);

  const summary = result.payload.graph.summary;
  vscode.window.showInformationMessage(
    `React Query Visualizer scan complete (${result.scannedWorkspaces.join(', ')}): ${summary.files} files, ${summary.actions} actions, ${summary.queryKeys} query keys.`,
  );

  if (result.payload.graph.parseErrors.length > 0) {
    const preview = result.payload.graph.parseErrors
      .slice(0, 3)
      .map((error) => `${error.file}: ${error.message}`)
      .join('\n');
    vscode.window.showWarningMessage(
      `React Query Visualizer parse errors: ${result.payload.graph.parseErrors.length}\n${preview}`,
    );
  }
}
