import * as vscode from 'vscode';

import type { LayoutConfig, WebviewPayload } from './types';

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

export class GraphPanel {
  private static current: GraphPanel | undefined;

  static createOrShow(extensionUri: vscode.Uri): GraphPanel {
    if (GraphPanel.current) {
      GraphPanel.current.panel.reveal(vscode.ViewColumn.One);
      return GraphPanel.current;
    }

    const panel = vscode.window.createWebviewPanel('rqvGraphPanel', 'React Query Visualizer', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
    });

    GraphPanel.current = new GraphPanel(panel, extensionUri);
    return GraphPanel.current;
  }

  static get currentPanel(): GraphPanel | undefined {
    return GraphPanel.current;
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly themeChangeListener: vscode.Disposable;
  private latestPayload?: WebviewPayload;
  private isReady = false;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.panel.webview.html = this.renderHtml();
    this.themeChangeListener = vscode.window.onDidChangeActiveColorTheme(() => {
      this.postTheme();
    });

    this.panel.onDidDispose(() => {
      this.themeChangeListener.dispose();
      if (GraphPanel.current === this) {
        GraphPanel.current = undefined;
      }
    });

    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      if (!message || typeof message !== 'object') {
        return;
      }

      const typed = message as { type?: string; file?: string; line?: number; column?: number };
      if (typed.type === 'ready') {
        this.isReady = true;
        this.postTheme();
        if (this.latestPayload) {
          this.postGraph(this.latestPayload);
        }
      }

      if (typed.type === 'reveal' && typed.file) {
        vscode.commands.executeCommand('rqv.revealInCode', {
          file: typed.file,
          line: typed.line,
          column: typed.column,
        });
      }
    });
  }

  update(payload: WebviewPayload): void {
    this.latestPayload = payload;
    if (this.isReady) {
      this.postGraph(payload);
    }
  }

  private postGraph(payload: WebviewPayload): void {
    this.panel.webview.postMessage({
      type: 'graphData',
      payload,
    });
  }

  private postTheme(): void {
    if (!this.isReady) {
      return;
    }

    const kind = vscode.window.activeColorTheme.kind;
    this.panel.webview.postMessage({
      type: 'theme',
      themeKind: kind,
    });
  }

  private renderHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.css'));
    const cspNonce = nonce();
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${cspNonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <link rel="stylesheet" href="${cssUri}" />
    <title>React Query Visualizer</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${cspNonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

export function getDefaultPayload(layout: LayoutConfig): WebviewPayload {
  return {
    graph: {
      nodes: [],
      edges: [],
      summary: {
        files: 0,
        actions: 0,
        queryKeys: 0,
        parseErrors: 0,
      },
      parseErrors: [],
    },
    scannedFiles: [],
    scopeLabel: 'No scan has run yet',
    layout,
  };
}
