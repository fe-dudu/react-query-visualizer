/* @vitest-environment jsdom */
import '../../../testing/setup';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { LeftPanelRelatedFiles } from '../LeftPanelRelatedFiles';

describe('webview/components/LeftPanelRelatedFiles', () => {
  it('dedupes files, renders project dividers, and collapses directories', async () => {
    const onSelectRelatedFile = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    function Harness() {
      const [collapsedDirectories, setCollapsedDirectories] = useState(new Set(['stale']));
      return createElement(LeftPanelRelatedFiles, {
        relatedFiles: [
          { path: 'api/src/query.ts', workspace: 'api', depth: 1, impact: 1 },
          { path: 'api/src/a.ts', workspace: 'api', depth: 1, impact: 1 },
          { path: 'api/src/z.ts', workspace: 'api', depth: 1, impact: 4 },
          { path: 'aaa/src/project.ts', workspace: 'aaa', depth: 1, impact: 6 },
          { path: 'web/src/query.ts', workspace: 'web', depth: 1, impact: 3 },
          { path: 'web/src/query.ts', workspace: 'web', depth: 1, impact: 99 },
          { path: 'web/src/nested/file.ts', workspace: 'web', depth: 2, impact: 2 },
          { path: 'lib/src/alpha.ts', workspace: 'lib', depth: 1, impact: 3 },
          { path: 'lib/src/beta.ts', workspace: 'lib', depth: 1 },
          { path: 'tie/a.ts', workspace: 'tie', depth: 1, impact: 1 },
          { path: 'tie/b.ts', workspace: 'tie', depth: 1, impact: 1 },
          { path: 'undef/a.ts', workspace: 'undef', depth: 1 },
          { path: 'undef/b.ts', workspace: 'undef', depth: 1 },
        ],
        fileQuery: '',
        selectedRelatedFilePath: 'web/src/query.ts',
        onSelectRelatedFile,
        showProjectDividers: true,
        collapsedDirectories,
        setCollapsedDirectories,
      });
    }

    await act(async () => {
      root.render(createElement(Harness));
    });

    expect(container.querySelectorAll('button[title="web/src/query.ts"]')).toHaveLength(1);
    expect(container.textContent).toContain('api');
    expect(container.textContent).toContain('web');

    const webProjectButton = Array.from(container.querySelectorAll('button')).find(
      (button) => !button.getAttribute('title') && button.textContent?.includes('web'),
    );
    await act(async () => {
      webProjectButton?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('button[title="web/src/query.ts"]')).toBeNull();
    expect(container.querySelector('button[title="web/src/nested/file.ts"]')).toBeNull();
    expect(container.querySelector('button[title="api/src/query.ts"]')).toBeTruthy();

    await act(async () => {
      webProjectButton?.click();
      await Promise.resolve();
    });
    expect(container.querySelector('button[title="web/src/query.ts"]')).toBeTruthy();

    const apiFileButton = container.querySelector('button[title="api/src/query.ts"]') as HTMLButtonElement | null;
    apiFileButton?.click();
    expect(onSelectRelatedFile).toHaveBeenCalledWith('api/src/query.ts');

    root.unmount();
  });

  it('renders the empty related files state when filters remove all files', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(LeftPanelRelatedFiles, {
          relatedFiles: [{ path: 'web/src/query.ts', workspace: 'web', depth: 1, impact: 1 }],
          fileQuery: 'missing',
          selectedRelatedFilePath: null,
          onSelectRelatedFile: vi.fn(),
          showProjectDividers: false,
          collapsedDirectories: new Set<string>(),
          setCollapsedDirectories: vi.fn(),
        }),
      );
    });

    expect(container.textContent).toContain('No related files in current filters.');
    root.unmount();
  });
});
