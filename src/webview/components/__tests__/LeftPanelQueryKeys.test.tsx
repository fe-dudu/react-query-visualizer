/* @vitest-environment jsdom */
import '../../../testing/setup';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { LeftPanelQueryKeys } from '../LeftPanelQueryKeys';

describe('webview/components/LeftPanelQueryKeys', () => {
  it('renders an empty state and forwards selection events', async () => {
    const onSelectQueryKey = vi.fn();
    const emptyContainer = document.createElement('div');
    document.body.appendChild(emptyContainer);
    const emptyRoot = createRoot(emptyContainer);

    await act(async () => {
      emptyRoot.render(
        createElement(LeftPanelQueryKeys, {
          queryKeys: [],
          selectedQueryKey: null,
          onSelectQueryKey,
        }),
      );
    });

    expect(emptyContainer.textContent).toContain('No query keys in current filters.');

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(LeftPanelQueryKeys, {
          queryKeys: ['alpha', 'beta'],
          selectedQueryKey: 'beta',
          onSelectQueryKey,
        }),
      );
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons[1]?.getAttribute('aria-current')).toBe('true');

    buttons[0]?.click();
    buttons[1]?.click();

    expect(onSelectQueryKey).toHaveBeenCalledWith('alpha');
    expect(onSelectQueryKey).toHaveBeenCalledWith('beta');

    root.unmount();
    emptyRoot.unmount();
  });
});
