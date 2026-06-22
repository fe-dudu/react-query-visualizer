/* @vitest-environment jsdom */
import '../../../testing/setup';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  Reflect.deleteProperty(window, 'acquireVsCodeApi');
  Reflect.deleteProperty(globalThis, 'acquireVsCodeApi');
  vi.resetModules();
});

describe('webview/utils/reveal', () => {
  it('posts reveal messages for nodes and callsites', async () => {
    const postMessage = vi.fn();
    vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage }));
    vi.resetModules();
    const { revealCallsiteInCode, revealFileInCode, revealNodeInCode } = await import('../reveal');

    expect(revealNodeInCode).toBeTypeOf('function');
    revealNodeInCode({ file: '/repo/src/file.ts', loc: { line: 2, column: 3 } } as never);
    revealNodeInCode({ file: '/repo/src/default-node.ts' } as never);
    revealCallsiteInCode({ file: '/repo/src/file.ts', line: 4, column: 5 } as never);
    revealCallsiteInCode({ file: '/repo/src/default-callsite.ts' } as never);
    revealFileInCode({ file: '/repo/src/file.ts', line: 6, column: 7 } as never);
    revealFileInCode({ file: '/repo/src/default-file.ts' } as never);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'reveal',
      file: '/repo/src/file.ts',
      line: 2,
      column: 3,
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'reveal',
      file: '/repo/src/file.ts',
      line: 4,
      column: 5,
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'reveal',
      file: '/repo/src/file.ts',
      line: 6,
      column: 7,
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'reveal',
      file: '/repo/src/default-node.ts',
      line: 1,
      column: 1,
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'reveal',
      file: '/repo/src/default-callsite.ts',
      line: 1,
      column: 1,
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'reveal',
      file: '/repo/src/default-file.ts',
      line: 1,
      column: 1,
    });
  });

  it('ignores reveal requests without file targets', async () => {
    const { revealCallsiteInCode, revealFileInCode, revealNodeInCode } = await import('../reveal');
    expect(() => revealNodeInCode({} as never)).not.toThrow();
    expect(() => revealCallsiteInCode({} as never)).not.toThrow();
    expect(() => revealFileInCode({} as never)).not.toThrow();
  });
});
