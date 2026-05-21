import type { ReactElement } from 'react';

import {
  type FileTreeDirectory,
  buildFileTree,
  collectDirectoryPaths,
  directoryImpact,
  displayFileName,
} from '../utils/leftPanelTree';
import type { ScannedFile } from '../types/model';

interface LeftPanelRelatedFilesProps {
  relatedFiles: ScannedFile[];
  fileQuery: string;
  selectedRelatedFilePath: string | null;
  onSelectRelatedFile: (filePath: string) => void;
  showProjectDividers: boolean;
  collapsedDirectories: Set<string>;
  setCollapsedDirectories: (updater: (previous: Set<string>) => Set<string>) => void;
}

function renderDirectoryRows(
  directory: FileTreeDirectory,
  level: number,
  showProjectDividers: boolean,
  collapsedDirectories: Set<string>,
  onSelectRelatedFile: (filePath: string) => void,
  selectedRelatedFilePath: string | null,
  toggleDirectory: (directoryPath: string) => void,
): ReactElement[] {
  const rows: ReactElement[] = [];
  const childDirectories = [...directory.directories.values()].sort(
    (a, b) => directoryImpact(b) - directoryImpact(a) || a.name.localeCompare(b.name),
  );
  const childFiles = [...directory.files].sort(
    (a, b) => Number(b.impact ?? 0) - Number(a.impact ?? 0) || a.path.localeCompare(b.path),
  );

  for (const [index, childDirectory] of childDirectories.entries()) {
    const collapsed = collapsedDirectories.has(childDirectory.path);

    if (level === 0 && showProjectDividers && index > 0) {
      rows.push(
        <li
          key={`divider:${childDirectory.path}`}
          className="my-2 h-px border-t border-zinc-300/70 dark:border-zinc-700/70"
        />,
      );
    }

    const impact = directoryImpact(childDirectory);
    rows.push(
      <li key={`dir:${childDirectory.path}`} className="mb-1">
        <button
          type="button"
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800/70"
          style={{ paddingLeft: `${level * 12 + 4}px` }}
          onClick={() => toggleDirectory(childDirectory.path)}
        >
          <span className="w-3 text-[10px] text-zinc-500 dark:text-zinc-400">{collapsed ? '▸' : '▾'}</span>
          <span className="break-all">{childDirectory.name}</span>
          <span className="ml-auto rounded border border-zinc-400/80 bg-zinc-200/80 px-1 py-[1px] text-[10px] text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800/80 dark:text-zinc-300">
            Q{impact}
          </span>
        </button>
      </li>,
    );

    if (!collapsed) {
      rows.push(
        ...renderDirectoryRows(
          childDirectory,
          level + 1,
          showProjectDividers,
          collapsedDirectories,
          onSelectRelatedFile,
          selectedRelatedFilePath,
          toggleDirectory,
        ),
      );
    }
  }

  for (const file of childFiles) {
    const selected = selectedRelatedFilePath === file.path;
    const impact = Number(file.impact ?? 0);
    const fileRowClassName = selected
      ? 'flex w-full items-center gap-2 rounded border border-zinc-500 bg-zinc-300/45 px-1 py-0.5 text-left text-zinc-900 transition-colors dark:border-zinc-300 dark:bg-zinc-700/40 dark:text-zinc-100'
      : 'flex w-full items-center gap-2 rounded border border-transparent px-1 py-0.5 text-left text-zinc-700 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100';
    rows.push(
      <li key={`file:${file.path}`} className="mb-1">
        <button
          type="button"
          className={fileRowClassName}
          style={{ paddingLeft: `${level * 12 + 20}px` }}
          title={file.path}
          aria-current={selected ? 'true' : undefined}
          onClick={() => onSelectRelatedFile(file.path)}
        >
          <span className="min-w-0 grow break-all">{displayFileName(file.path)}</span>
          <span className="rounded border border-zinc-400/80 bg-zinc-200/80 px-1 py-[1px] text-[10px] text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800/80 dark:text-zinc-300">
            Q{impact}
          </span>
        </button>
      </li>,
    );
  }

  return rows;
}

export function LeftPanelRelatedFiles({
  relatedFiles,
  fileQuery,
  selectedRelatedFilePath,
  onSelectRelatedFile,
  showProjectDividers,
  collapsedDirectories,
  setCollapsedDirectories,
}: LeftPanelRelatedFilesProps): ReactElement {
  const unique = new Map<string, ScannedFile>();
  for (const file of relatedFiles) {
    if (!unique.has(file.path)) {
      unique.set(file.path, file);
    }
  }

  const deduped = [...unique.values()].sort((a, b) => a.path.localeCompare(b.path));
  const query = fileQuery.trim().toLowerCase();
  const filteredRelatedFiles =
    query.length === 0 ? deduped : deduped.filter((file) => file.path.toLowerCase().includes(query));
  if (filteredRelatedFiles.length === 0) {
    return <p className="text-xs text-zinc-500 dark:text-zinc-400">No related files in current filters.</p>;
  }

  const fileTreeRoot = buildFileTree(filteredRelatedFiles);
  const directoryPaths = collectDirectoryPaths(fileTreeRoot);

  const toggleDirectory = (directoryPath: string) => {
    setCollapsedDirectories((previous) => {
      const next = new Set(previous);
      if (next.has(directoryPath)) {
        next.delete(directoryPath);
      } else {
        next.add(directoryPath);
      }
      return next;
    });
  };

  const prunedCollapsedDirectories = new Set<string>();
  for (const pathValue of collapsedDirectories) {
    if (directoryPaths.has(pathValue)) {
      prunedCollapsedDirectories.add(pathValue);
    }
  }

  return (
    <ul className="min-h-0 flex-1 overflow-auto pr-1 text-xs">
      {renderDirectoryRows(
        fileTreeRoot,
        0,
        showProjectDividers,
        prunedCollapsedDirectories,
        onSelectRelatedFile,
        selectedRelatedFilePath,
        toggleDirectory,
      )}
    </ul>
  );
}
