type WorkspaceFolder = { name: string; uri: { fsPath: string } };

type WorkspaceConfiguration = {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown, target: unknown): Promise<undefined>;
};

type DisposableLike = { dispose: () => undefined };

type Webview = {
  html: string;
  cspSource: string;
  asWebviewUri: (uri: { toString: () => string }) => string;
  postMessage: (message: unknown) => Promise<boolean>;
  onDidReceiveMessage: (handler: (message: unknown) => void) => DisposableLike;
};

type WebviewPanel = {
  webview: Webview;
  reveal: () => undefined;
  onDidDispose: (handler: () => void) => DisposableLike;
};

type TreeView<T> = {
  dispose: () => undefined;
  reveal: (item: T) => void;
  onDidCollapseElement: (handler: (event: { element: { children: unknown[] } }) => void) => DisposableLike;
};

export const workspace = {
  workspaceFolders: [] as WorkspaceFolder[],
  getConfiguration: (): WorkspaceConfiguration => ({
    get: <T>(_key: string, fallback: T): T => fallback,
    update: async () => undefined,
  }),
  openTextDocument: async (..._args: unknown[]) => ({}),
  getWorkspaceFolder: () => undefined,
};

export const window = {
  activeTextEditor: undefined as { document: { uri: { fsPath: string } } } | undefined,
  activeColorTheme: undefined as { kind: number } | undefined,
  showWarningMessage: async (..._args: unknown[]) => undefined,
  showInformationMessage: async (..._args: unknown[]) => undefined,
  showTextDocument: async (..._args: unknown[]) => ({ selection: null, revealRange: () => undefined }),
  showOpenDialog: async (..._args: unknown[]): Promise<unknown[] | undefined> => undefined,
  showInputBox: async (..._args: unknown[]): Promise<string | undefined> => undefined,
  createTreeView: <T>(_id: string, _options: unknown): TreeView<T> => ({
    dispose: () => undefined,
    reveal: () => undefined,
    onDidCollapseElement: () => ({ dispose: () => undefined }),
  }),
  createWebviewPanel: (): WebviewPanel => ({
    webview: {
      html: '',
      cspSource: 'vscode-resource:',
      asWebviewUri: (uri: { toString: () => string }) => uri.toString(),
      postMessage: async () => true,
      onDidReceiveMessage: () => ({ dispose: () => undefined }),
    },
    reveal: () => undefined,
    onDidDispose: () => ({ dispose: () => undefined }),
  }),
  onDidChangeActiveColorTheme: (_handler: () => void) => {
    return { dispose: () => undefined };
  },
  withProgress: async (
    _options: unknown,
    task: (progress: { report: (_value: unknown) => void }) => Promise<unknown>,
  ) => task({ report: () => undefined }),
};

export const commands = {
  executeCommand: async (..._args: unknown[]) => undefined,
  registerCommand: (_name: string, _callback: (...args: unknown[]) => unknown) => ({
    dispose: () => undefined,
  }),
};

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Selection {
  constructor(
    public readonly anchor: unknown,
    public readonly active: unknown,
  ) {}
}

export class Range {
  constructor(
    public readonly start: unknown,
    public readonly end: unknown,
  ) {}
}

export const TextEditorRevealType = {
  InCenter: 1,
};

export const ConfigurationTarget = {
  Workspace: 'workspace',
} as const;

export const ViewColumn = {
  One: 1,
} as const;

export const ProgressLocation = {
  Notification: 1,
} as const;

export class Uri {
  scheme = 'file';
  authority = '';
  path: string;
  query = '';
  fragment = '';

  constructor(public readonly fsPath: string) {
    this.path = fsPath;
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri([base.fsPath, ...segments].join('/'));
  }

  static file(value: string): Uri {
    return new Uri(value);
  }

  with(): Uri {
    return this;
  }

  toJSON(): { fsPath: string } {
    return { fsPath: this.fsPath };
  }

  toString(): string {
    return this.fsPath;
  }
}

export class ThemeIcon {
  constructor(public readonly id: string) {}
}

export class TreeItem {
  id?: string;
  description?: string;
  tooltip?: string;
  iconPath?: ThemeIcon;
  command?: { command: string; title: string; arguments?: unknown[] };

  constructor(
    public label: string,
    public collapsibleState: number,
  ) {}
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const;

export class EventEmitter<T> {
  event = () => ({ dispose: () => undefined });

  fire(_value: T): void {}
}

export interface Disposable {
  dispose(): void;
}
