import * as vscode from 'vscode';

import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE } from './glob';
import type { LayoutConfig, ScanScope } from '../types';

export function getScanScopeConfig(): ScanScope {
  const config = vscode.workspace.getConfiguration('rqv');
  const folders = config.get<string[]>('scope.folders', []);
  const includeGlob = config.get<string>('scope.include', DEFAULT_INCLUDE);
  const excludeGlob = config.get<string>('scope.exclude', DEFAULT_EXCLUDE);
  const useGitIgnore = config.get<boolean>('scan.useGitIgnore', true);
  const maxFileSizeKB = config.get<number>('scan.maxFileSizeKB', 512);

  return {
    folders,
    includeGlob,
    excludeGlob,
    useGitIgnore,
    maxFileSizeKB,
  };
}

export function getLayoutConfig(): LayoutConfig {
  const config = vscode.workspace.getConfiguration('rqv');

  return {
    direction: 'LR',
    engine: 'dagre',
    verticalSpacing: config.get<number>('graph.verticalSpacing', config.get<number>('graph.nodeSpacing', 30)),
    horizontalSpacing: config.get<number>('graph.horizontalSpacing', 500),
  };
}

export async function persistScanScope(scope: ScanScope): Promise<void> {
  const config = vscode.workspace.getConfiguration('rqv');
  await config.update('scope.folders', scope.folders, vscode.ConfigurationTarget.Workspace);
  await config.update('scope.include', scope.includeGlob, vscode.ConfigurationTarget.Workspace);
  await config.update('scope.exclude', scope.excludeGlob, vscode.ConfigurationTarget.Workspace);
  await config.update('scan.useGitIgnore', scope.useGitIgnore, vscode.ConfigurationTarget.Workspace);
  await config.update('scan.maxFileSizeKB', scope.maxFileSizeKB, vscode.ConfigurationTarget.Workspace);
}
