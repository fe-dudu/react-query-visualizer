declare global {
  function acquireVsCodeApi(): {
    postMessage: (message: unknown) => void;
  };

  interface Window {
    acquireVsCodeApi?: () => {
      postMessage: (message: unknown) => void;
    };
  }
}

function getVsCodeApi() {
  if (typeof acquireVsCodeApi === 'function') {
    return acquireVsCodeApi();
  }

  if (typeof window.acquireVsCodeApi === 'function') {
    return window.acquireVsCodeApi();
  }

  return undefined;
}

export const vscode = getVsCodeApi();
