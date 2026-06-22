/* @vitest-environment jsdom */
import '../../testing/setup';
import type { ReactElement } from 'react';
import { StrictMode, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

function isReactElement(value: unknown): value is ReactElement<{ children: unknown }> {
  return !!value && typeof value === 'object' && 'type' in value && 'props' in value;
}

describe('webview/index', () => {
  it('boots the app into the root element', async () => {
    const render = vi.fn();
    vi.doMock('react-dom/client', () => ({
      createRoot: () => ({ render }),
    }));
    vi.doMock('../App', () => ({
      default: () => createElement('div', { 'data-testid': 'app' }),
    }));

    document.body.innerHTML = '<div id="root"></div>';
    await import('../index');

    expect(render).toHaveBeenCalledTimes(1);
    const renderedElement = render.mock.calls[0]?.[0];
    if (!isReactElement(renderedElement)) {
      throw new Error('Expected React element');
    }
    expect(renderedElement.type).toBe(StrictMode);
    expect(renderedElement.props.children).toMatchObject({
      type: expect.any(Function),
    });
  });

  it('throws when the root container is missing', async () => {
    vi.resetModules();
    document.body.innerHTML = '';

    await expect(import('../index')).rejects.toThrow('Webview root container not found');
  });
});
