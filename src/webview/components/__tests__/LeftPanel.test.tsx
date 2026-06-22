/* @vitest-environment jsdom */
import '../../../testing/setup';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { LeftPanel } from '../LeftPanel';
import { defaultFilters } from '../../utils/defaultFilters';

function changeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('webview/components/LeftPanel', () => {
  it('applies drafts and forwards selection callbacks', async () => {
    const setFilters = vi.fn((updater: unknown) => {
      if (typeof updater === 'function') {
        updater(defaultFilters);
      }
    });
    const onVerticalSpacingChange = vi.fn();
    const onHorizontalSpacingChange = vi.fn();
    const onSelectQueryKey = vi.fn();
    const onSelectRelatedFile = vi.fn();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(LeftPanel, {
          filters: {
            ...defaultFilters,
            fileQuery: '',
            search: '',
          },
          setFilters,
          queryKeys: ['todos', 'users'],
          selectedQueryKey: 'todos',
          onSelectQueryKey,
          relatedFiles: [
            { path: 'api/src/query.ts', workspace: 'api', depth: 1, impact: 2 },
            { path: 'web/src/query.ts', workspace: 'web', depth: 1, impact: 3 },
            { path: 'web/src/query.ts', workspace: 'web', depth: 1, impact: 99 },
            { path: 'web/src/nested/file.ts', workspace: 'web', depth: 2, impact: 1 },
          ],
          verticalSpacing: 30,
          onVerticalSpacingChange,
          horizontalSpacing: 500,
          onHorizontalSpacingChange,
          showProjectDividers: true,
          selectedRelatedFilePath: 'web/src/query.ts',
          onSelectRelatedFile,
        }),
      );
    });

    expect(container.textContent).toContain('todos');

    const queryKeyButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'users',
    );
    queryKeyButton?.click();
    expect(onSelectQueryKey).toHaveBeenCalledWith('users');

    const fileButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('title') === 'web/src/nested/file.ts',
    );
    fileButton?.click();
    expect(onSelectRelatedFile).toHaveBeenCalledWith('web/src/nested/file.ts');

    await act(async () => {
      const fileQueryInput = container.querySelector('input[placeholder="Filter files"]') as HTMLInputElement | null;
      expect(fileQueryInput).toBeTruthy();
      if (fileQueryInput) {
        fileQueryInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        changeInputValue(fileQueryInput, 'web');
        fileQueryInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fileQueryInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }

      const searchInput = container.querySelector('input[placeholder="Search labels"]') as HTMLInputElement | null;
      expect(searchInput).toBeTruthy();
      if (searchInput) {
        changeInputValue(searchInput, 'todo');
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }

      const applyFiltersButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Apply Filters'),
      );
      applyFiltersButton?.click();

      const invalidatesCheckbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      if (invalidatesCheckbox) {
        invalidatesCheckbox.click();
      }
      const applyOperationsButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Apply Operations'),
      );
      applyOperationsButton?.click();

      const verticalInput = container.querySelector('#rqv-vertical-spacing') as HTMLInputElement | null;
      const horizontalInput = container.querySelector('#rqv-horizontal-spacing') as HTMLInputElement | null;
      if (verticalInput) {
        changeInputValue(verticalInput, '44');
        verticalInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (horizontalInput) {
        changeInputValue(horizontalInput, '750');
        horizontalInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const applyLayoutButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Apply Layout'),
      );
      applyLayoutButton?.click();
    });

    expect(setFilters).toHaveBeenCalled();

    const operationsHeader = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Operations'),
    );
    const filtersHeader = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Filter'),
    );
    const layoutHeader = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Layout'),
    );
    await act(async () => {
      operationsHeader?.click();
      filtersHeader?.click();
      layoutHeader?.click();
      await Promise.resolve();
    });

    root.unmount();
  });

  it('collapses sections and ignores no-op apply actions', async () => {
    const setFilters = vi.fn();
    const onVerticalSpacingChange = vi.fn();
    const onHorizontalSpacingChange = vi.fn();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(LeftPanel, {
          filters: {
            ...defaultFilters,
            fileQuery: '',
            search: '',
          },
          setFilters,
          queryKeys: ['todos'],
          selectedQueryKey: null,
          onSelectQueryKey: vi.fn(),
          relatedFiles: [{ path: 'web/src/query.ts', workspace: 'web', depth: 1, impact: 1 }],
          verticalSpacing: 30,
          onVerticalSpacingChange,
          horizontalSpacing: 500,
          onHorizontalSpacingChange,
          showProjectDividers: false,
          selectedRelatedFilePath: null,
          onSelectRelatedFile: vi.fn(),
        }),
      );
    });

    const applyOperationsButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Apply Operations'),
    );
    const applyFiltersButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Apply Filters'),
    );
    const applyLayoutButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Apply Layout'),
    );
    applyOperationsButton?.click();
    applyFiltersButton?.click();
    applyLayoutButton?.click();

    expect(setFilters).not.toHaveBeenCalled();
    expect(onVerticalSpacingChange).not.toHaveBeenCalled();
    expect(onHorizontalSpacingChange).not.toHaveBeenCalled();

    let queryKeysHeader = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Current Query Keys'),
    );
    await act(async () => {
      queryKeysHeader?.click();
      await Promise.resolve();
    });

    expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'todos')).toBe(
      false,
    );
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.getAttribute('title') === 'web/src/query.ts',
      ),
    ).toBe(true);

    queryKeysHeader = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Current Query Keys'),
    );
    const relatedFilesHeader = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Related Files'),
    );
    await act(async () => {
      queryKeysHeader?.click();
      relatedFilesHeader?.click();
      await Promise.resolve();
    });

    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.getAttribute('title') === 'web/src/query.ts',
      ),
    ).toBe(false);

    root.unmount();
  });

  it('syncs drafts from props and prunes collapsed directories when filters change', async () => {
    const setFilters = vi.fn();
    const onVerticalSpacingChange = vi.fn();
    const onHorizontalSpacingChange = vi.fn();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const initialProps = {
      filters: {
        ...defaultFilters,
        fileQuery: '',
        search: '',
      },
      setFilters,
      queryKeys: ['todos', 'users'],
      selectedQueryKey: null,
      onSelectQueryKey: vi.fn(),
      relatedFiles: [
        { path: 'api/src/query.ts', workspace: 'api', depth: 1, impact: 2 },
        { path: 'web/src/query.ts', workspace: 'web', depth: 1, impact: 3 },
        { path: 'web/src/nested/file.ts', workspace: 'web', depth: 2, impact: 1 },
      ],
      verticalSpacing: 30,
      onVerticalSpacingChange,
      horizontalSpacing: 500,
      onHorizontalSpacingChange,
      showProjectDividers: true,
      selectedRelatedFilePath: null,
      onSelectRelatedFile: vi.fn(),
    };

    await act(async () => {
      root.render(createElement(LeftPanel, initialProps));
    });

    const webDirectoryButton = Array.from(container.querySelectorAll('button')).find(
      (button) => !button.getAttribute('title') && button.textContent?.includes('web'),
    );
    await act(async () => {
      webDirectoryButton?.click();
      await Promise.resolve();
    });

    await act(async () => {
      root.render(
        createElement(LeftPanel, {
          ...initialProps,
          filters: {
            ...defaultFilters,
            fileQuery: 'web',
            search: 'todo',
          },
          relatedFiles: [
            { path: 'web/src/query.ts', workspace: 'web', depth: 1, impact: 3 },
            { path: 'web/src/nested/file.ts', workspace: 'web', depth: 2, impact: 1 },
          ],
          verticalSpacing: 44,
          horizontalSpacing: 750,
        }),
      );
    });

    await act(async () => {
      root.render(
        createElement(LeftPanel, {
          ...initialProps,
          filters: {
            ...defaultFilters,
            fileQuery: 'api',
            search: 'todo',
          },
          relatedFiles: [{ path: 'api/src/query.ts', workspace: 'api', depth: 1, impact: 2 }],
          verticalSpacing: 44,
          horizontalSpacing: 750,
        }),
      );
    });

    const fileQueryInput = container.querySelector('input[placeholder="Filter files"]') as HTMLInputElement | null;
    const searchInput = container.querySelector('input[placeholder="Search labels"]') as HTMLInputElement | null;
    const verticalInput = container.querySelector('#rqv-vertical-spacing') as HTMLInputElement | null;
    const horizontalInput = container.querySelector('#rqv-horizontal-spacing') as HTMLInputElement | null;

    expect(fileQueryInput?.value).toBe('api');
    expect(searchInput?.value).toBe('todo');
    expect(verticalInput?.value).toBe('44');
    expect(horizontalInput?.value).toBe('750');

    root.unmount();
    expect(setFilters).not.toHaveBeenCalled();
    expect(onVerticalSpacingChange).not.toHaveBeenCalled();
    expect(onHorizontalSpacingChange).not.toHaveBeenCalled();
  });

  it('applyDraftLayout returns early when there are no pending layout changes', async () => {
    // The "Apply Layout" button is disabled when drafts match props. Clicking a disabled
    // <button> via element.click() does not fire the React handler in jsdom, so we use
    // dispatchEvent with a synthetic click which bypasses the disabled check at the DOM
    // level while still reaching React's bubbled handler.
    const onVerticalSpacingChange = vi.fn();
    const onHorizontalSpacingChange = vi.fn();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(LeftPanel, {
          filters: { ...defaultFilters, fileQuery: '', search: '' },
          setFilters: vi.fn(),
          queryKeys: [],
          selectedQueryKey: null,
          onSelectQueryKey: vi.fn(),
          relatedFiles: [],
          verticalSpacing: 30,
          onVerticalSpacingChange,
          horizontalSpacing: 500,
          onHorizontalSpacingChange,
          showProjectDividers: false,
          selectedRelatedFilePath: null,
          onSelectRelatedFile: vi.fn(),
        }),
      );
    });

    // Draft values equal the incoming props, so hasPendingLayoutChanges = false.
    const applyLayoutButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Apply Layout'),
    );
    expect(applyLayoutButton).toBeTruthy();
    expect(applyLayoutButton?.disabled).toBe(true);
    if (applyLayoutButton instanceof HTMLButtonElement) {
      applyLayoutButton.disabled = false;
    }

    // dispatchEvent bubbles through React's delegation layer and fires onClick even on
    // a disabled button, so applyDraftLayout runs — and hits the early-return branch.
    await act(async () => {
      applyLayoutButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      applyLayoutButton?.click();
      await Promise.resolve();
    });

    // No spacing changes should have propagated because the guard returned early.
    expect(onVerticalSpacingChange).not.toHaveBeenCalled();
    expect(onHorizontalSpacingChange).not.toHaveBeenCalled();

    root.unmount();
  });
});
