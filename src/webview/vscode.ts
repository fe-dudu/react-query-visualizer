declare global {
  interface Window {
    acquireVsCodeApi?: () => {
      postMessage: (message: unknown) => void;
    };
  }
}

export const vscode = window.acquireVsCodeApi ? window.acquireVsCodeApi() : undefined;
