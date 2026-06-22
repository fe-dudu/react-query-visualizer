/* @vitest-environment jsdom */
import '../../../testing/setup';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { useResizablePanels } from '../useResizablePanels';

let originalClientWidth: PropertyDescriptor | undefined;

afterEach(() => {
  if (originalClientWidth) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    originalClientWidth = undefined;
  }
});

describe('webview/layout/useResizablePanels', () => {
  it('resizes both side panels within bounds', async () => {
    originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 1200,
    });

    let latest: ReturnType<typeof useResizablePanels> | undefined;

    function Harness() {
      const result = useResizablePanels();
      useEffect(() => {
        latest = result;
      }, [result]);

      return <div ref={result.shellRef} data-testid="shell" style={result.shellStyle} />;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Harness />);
    });

    const shell = container.querySelector('[data-testid="shell"]') as HTMLDivElement;
    expect(shell.style.getPropertyValue('--rqv-left-width')).toBe('280px');
    expect(shell.style.getPropertyValue('--rqv-right-width')).toBe('300px');

    await act(async () => {
      latest?.startResize('left')({
        currentTarget: { setPointerCapture: () => undefined },
        pointerId: 1,
        clientX: 100,
        preventDefault: () => undefined,
      } as never);
    });

    await act(async () => {
      window.dispatchEvent(
        Object.assign(new Event('pointermove'), {
          clientX: 220,
        }),
      );
      window.dispatchEvent(new Event('pointerup'));
    });

    expect(shell.style.getPropertyValue('--rqv-left-width')).toBe('400px');

    await act(async () => {
      latest?.startResize('right')({
        currentTarget: { setPointerCapture: () => undefined },
        pointerId: 2,
        clientX: 260,
        preventDefault: () => undefined,
      } as never);
    });

    await act(async () => {
      window.dispatchEvent(
        Object.assign(new Event('pointermove'), {
          clientX: 220,
        }),
      );
      window.dispatchEvent(new Event('pointerup'));
    });

    expect(shell.style.getPropertyValue('--rqv-right-width')).toBe('340px');
    root.unmount();
  });

  it('clamps widths on resize when the shell becomes narrow', async () => {
    originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 700,
    });

    let latest: ReturnType<typeof useResizablePanels> | undefined;

    function Harness() {
      const result = useResizablePanels(400, 360);
      useEffect(() => {
        latest = result;
      }, [result]);

      return <div ref={result.shellRef} data-testid="shell" style={result.shellStyle} />;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Harness />);
    });

    const shell = container.querySelector('[data-testid="shell"]') as HTMLDivElement;
    expect(shell.style.getPropertyValue('--rqv-left-width')).not.toBe('400px');
    expect(shell.style.getPropertyValue('--rqv-right-width')).not.toBe('360px');

    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(latest?.shellStyle).toBeDefined();
    root.unmount();
  });

  it('ignores pointer and resize events before the shell ref is attached', async () => {
    let latest: ReturnType<typeof useResizablePanels> | undefined;

    function Harness() {
      const result = useResizablePanels();
      useEffect(() => {
        latest = result;
      }, [result]);

      return <div data-testid="no-ref" />;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Harness />);
    });

    await act(async () => {
      window.dispatchEvent(new Event('resize'));
      latest?.startResize('left')({
        currentTarget: { setPointerCapture: () => undefined },
        pointerId: 1,
        clientX: 100,
        preventDefault: () => undefined,
      } as never);
    });

    await act(async () => {
      window.dispatchEvent(
        Object.assign(new Event('pointermove'), {
          clientX: 120,
        }),
      );
      window.dispatchEvent(new Event('pointerup'));
    });

    expect(latest?.shellStyle).toMatchObject({
      '--rqv-left-width': '280px',
      '--rqv-right-width': '300px',
    });
    root.unmount();
  });
});
