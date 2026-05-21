import type { ReactElement } from 'react';

interface LeftPanelQueryKeysProps {
  queryKeys: string[];
  selectedQueryKey: string | null;
  onSelectQueryKey: (queryKey: string) => void;
}

export function LeftPanelQueryKeys({
  queryKeys,
  selectedQueryKey,
  onSelectQueryKey,
}: LeftPanelQueryKeysProps): ReactElement {
  return queryKeys.length === 0 ? (
    <p className="text-xs text-zinc-500 dark:text-zinc-400">No query keys in current filters.</p>
  ) : (
    <ul className="min-h-0 flex-1 overflow-auto pr-1 text-xs">
      {queryKeys.map((queryKey) => {
        const selected = selectedQueryKey === queryKey;
        const queryKeyClassName = selected
          ? 'mb-1 w-full rounded-md border border-zinc-500 bg-zinc-300/45 px-2 py-1 break-all text-left text-zinc-900 transition-colors dark:border-zinc-300 dark:bg-zinc-700/40 dark:text-zinc-100'
          : 'mb-1 w-full rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 break-all text-left text-zinc-700 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100';

        return (
          <li key={queryKey}>
            <button
              type="button"
              className={queryKeyClassName}
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelectQueryKey(queryKey)}
            >
              {queryKey}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
