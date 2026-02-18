import * as vscode from 'vscode';

import type { WebviewPayload } from './types';
import { RqvActivityViewProvider } from './activityView';
import { getLayoutConfig, getScanScopeConfig } from './core/config';
import { promptScope } from './core/scope';
import { revealInCode } from './extension/reveal';
import { getDefaultScopeWorkspace, getWorkspaceFolders } from './extension/workspace';
import { GraphPanel, getDefaultPayload } from './graphPanel';

let latestPayload: WebviewPayload | undefined;
let activityViewProvider: RqvActivityViewProvider | undefined;
let scanModulePromise: Promise<typeof import('./extension/scan')> | undefined;

function loadScanModule(): Promise<typeof import('./extension/scan')> {
  if (!scanModulePromise) {
    scanModulePromise = import('./extension/scan');
  }

  return scanModulePromise;
}

function setLatestPayload(payload: WebviewPayload): void {
  latestPayload = payload;
}

export function activate(context: vscode.ExtensionContext): void {
  activityViewProvider = new RqvActivityViewProvider();
  const activityTreeView = vscode.window.createTreeView('rqv.activityView', {
    treeDataProvider: activityViewProvider,
    showCollapseAll: false,
  });
  const keepActivityExpanded = activityTreeView.onDidCollapseElement((event) => {
    if (event.element.children.length === 0) {
      return;
    }

    activityTreeView
      .reveal(event.element, {
        expand: true,
        focus: false,
        select: false,
      })
      .then(undefined, () => undefined);
  });

  const focusActivity = vscode.commands.registerCommand('rqv.focusActivity', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.rqvContainer');
  });

  const openPanel = vscode.commands.registerCommand('rqv.openGraphPanel', () => {
    const panel = GraphPanel.createOrShow(context.extensionUri);
    const payload = latestPayload ?? getDefaultPayload(getLayoutConfig());
    if (latestPayload) {
      activityViewProvider?.updateFromPayload(latestPayload);
    }
    panel.update(payload);
  });

  const scanNow = vscode.commands.registerCommand('rqv.scanNow', async () => {
    const scope = getScanScopeConfig();
    const { scanAndPublish } = await loadScanModule();
    await scanAndPublish({
      context,
      scope,
      persistScopeFlag: false,
      activityViewProvider,
      onPayloadUpdated: setLatestPayload,
    });
  });

  const scanWithScope = vscode.commands.registerCommand('rqv.scanWithScope', async () => {
    const workspaces = getWorkspaceFolders();
    if (workspaces.length === 0) {
      vscode.window.showWarningMessage('React Query Visualizer: Open a workspace folder first.');
      return;
    }

    const defaultWorkspace = getDefaultScopeWorkspace(workspaces);
    const scope = await promptScope(defaultWorkspace);
    if (!scope) {
      return;
    }

    const { scanAndPublish } = await loadScanModule();
    await scanAndPublish({
      context,
      scope,
      persistScopeFlag: true,
      activityViewProvider,
      onPayloadUpdated: setLatestPayload,
    });
  });

  const reveal = vscode.commands.registerCommand(
    'rqv.revealInCode',
    async (args?: { file?: string; line?: number; column?: number }) => {
      await revealInCode(args);
    },
  );

  context.subscriptions.push(
    activityTreeView,
    keepActivityExpanded,
    focusActivity,
    openPanel,
    scanNow,
    scanWithScope,
    reveal,
  );
}

export function deactivate(): void {
  // no-op
}
