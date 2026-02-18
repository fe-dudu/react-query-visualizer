import { type Dispatch, type ReactElement, type SetStateAction, useEffect, useMemo, useState } from 'react';

import { OPERATION_RELATIONS, RELATION_COLOR, RELATION_LABEL } from '../constants';
import type { OperationRelation, ScannedFile } from '../model';
import { cx } from '../utils';
import type { FilterState } from '../viewTypes';

interface LeftPanelProps {
  filters: FilterState;
  setFilters: Dispatch<SetStateAction<FilterState>>;
  queryKeys: string[];
  selectedQueryKey: string | null;
  onSelectQueryKey: (queryKey: string) => void;
  relatedFiles: ScannedFile[];
  verticalSpacing: number;
  onVerticalSpacingChange: (value: number) => void;
  horizontalSpacing: number;
  onHorizontalSpacingChange: (value: number) => void;
  showProjectDividers: boolean;
  selectedRelatedFilePath: string | null;
  onSelectRelatedFile: (filePath: string) => void;
}

type PanelSectionKey = 'operations' | 'filters' | 'layout' | 'queryKeys' | 'relatedFiles';

const LEFT_PANEL_OPERATION_RELATIONS: OperationRelation[] = [
  'invalidates',
  'sets',
  ...OPERATION_RELATIONS.filter((relation) => relation !== 'invalidates' && relation !== 'sets'),
];

interface FileTreeDirectory {
  name: string;
  path: string;
  impact: number;
  directories: Map<string, FileTreeDirectory>;
  files: ScannedFile[];
}

function normalizePathSegments(input: string): string[] {
  return input.split('/').filter(Boolean);
}

function buildFileTree(relatedFiles: ScannedFile[]): FileTreeDirectory {
  const root: FileTreeDirectory = {
    name: '',
    path: '',
    impact: 0,
    directories: new Map(),
    files: [],
  };

  for (const file of relatedFiles) {
    const project = (file.project ?? file.workspace) || 'workspace';
    const relativePath = file.projectRelativePath ?? file.path;
    const segments = normalizePathSegments(relativePath);
    const impact = Number(file.impact ?? 0);

    let projectDirectory = root.directories.get(project);
    if (!projectDirectory) {
      projectDirectory = {
        name: project,
        path: project,
        impact: 0,
        directories: new Map(),
        files: [],
      };
      root.directories.set(project, projectDirectory);
    }
    projectDirectory.impact += impact;

    if (segments.length === 0) {
      continue;
    }

    let current = projectDirectory;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      if (!segment) {
        continue;
      }

      const segmentPath = `${project}/${segments.slice(0, index + 1).join('/')}`;
      const existing = current.directories.get(segment);
      if (existing) {
        existing.impact += impact;
        current = existing;
        continue;
      }

      const nextDirectory: FileTreeDirectory = {
        name: segment,
        path: segmentPath,
        impact,
        directories: new Map(),
        files: [],
      };
      current.directories.set(segment, nextDirectory);
      current = nextDirectory;
    }

    current.files.push(file);
  }

  return root;
}

function displayFileName(pathValue: string): string {
  const segments = normalizePathSegments(pathValue);
  return segments[segments.length - 1] ?? pathValue;
}

function directoryImpact(directory: FileTreeDirectory): number {
  return directory.impact;
}

function collectDirectoryPaths(root: FileTreeDirectory): Set<string> {
  const paths = new Set<string>();

  const visit = (directory: FileTreeDirectory) => {
    for (const child of directory.directories.values()) {
      paths.add(child.path);
      visit(child);
    }
  };

  visit(root);
  return paths;
}

export function LeftPanel({
  filters,
  setFilters,
  queryKeys,
  selectedQueryKey,
  onSelectQueryKey,
  relatedFiles,
  verticalSpacing,
  onVerticalSpacingChange,
  horizontalSpacing,
  onHorizontalSpacingChange,
  showProjectDividers,
  selectedRelatedFilePath,
  onSelectRelatedFile,
}: LeftPanelProps) {
  const [collapsedSections, setCollapsedSections] = useState<Record<PanelSectionKey, boolean>>({
    operations: false,
    filters: false,
    layout: false,
    queryKeys: false,
    relatedFiles: false,
  });
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(() => new Set());

  const filteredRelatedFiles = useMemo(() => {
    const unique = new Map<string, ScannedFile>();
    for (const file of relatedFiles) {
      if (!unique.has(file.path)) {
        unique.set(file.path, file);
      }
    }

    const deduped = [...unique.values()].sort((a, b) => a.path.localeCompare(b.path));
    const query = filters.fileQuery.trim().toLowerCase();
    if (query.length === 0) {
      return deduped;
    }

    return deduped.filter((file) => file.path.toLowerCase().includes(query));
  }, [relatedFiles, filters.fileQuery]);

  const fileTreeRoot = useMemo(() => buildFileTree(filteredRelatedFiles), [filteredRelatedFiles]);
  const directoryPaths = useMemo(() => collectDirectoryPaths(fileTreeRoot), [fileTreeRoot]);

  useEffect(() => {
    setCollapsedDirectories((previous) => {
      const next = new Set<string>();
      for (const pathValue of previous) {
        if (directoryPaths.has(pathValue)) {
          next.add(pathValue);
        }
      }
      return next;
    });
  }, [directoryPaths]);

  const toggleRelation = (relation: OperationRelation) => {
    setFilters((prev) => ({
      ...prev,
      relation: {
        ...prev.relation,
        [relation]: !prev.relation[relation],
      },
    }));
  };

  const toggleSection = (section: PanelSectionKey) => {
    setCollapsedSections((previous) => ({
      ...previous,
      [section]: !previous[section],
    }));
  };

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

  const sectionHeader = (title: string, section: PanelSectionKey, extra?: string) => {
    const collapsed = collapsedSections[section];

    return (
      <button
        type="button"
        className="mb-2 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-zinc-200/70 dark:hover:bg-zinc-800/70"
        onClick={() => toggleSection(section)}
      >
        <span className="w-3 text-[10px] text-zinc-500 dark:text-zinc-400">{collapsed ? '▸' : '▾'}</span>
        <h3 className="text-[13px] tracking-[0.05em] text-zinc-600 dark:text-zinc-300">
          {title}
          {extra ? ` (${extra})` : ''}
        </h3>
      </button>
    );
  };

  const renderDirectory = (directory: FileTreeDirectory, level: number): ReactElement[] => {
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
        rows.push(...renderDirectory(childDirectory, level + 1));
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
  };

  let queryKeysContent: ReactElement | null = null;
  if (!collapsedSections.queryKeys) {
    queryKeysContent =
      queryKeys.length === 0 ? (
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

  let relatedFilesContent: ReactElement | null = null;
  if (!collapsedSections.relatedFiles) {
    relatedFilesContent =
      filteredRelatedFiles.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">No related files in current filters.</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-auto pr-1 text-xs">{renderDirectory(fileTreeRoot, 0)}</ul>
      );
  }

  const queryKeysExpanded = !collapsedSections.queryKeys;
  const relatedFilesExpanded = !collapsedSections.relatedFiles;
  let queryKeysSectionSizeClass = 'grow basis-0';
  if (collapsedSections.queryKeys) {
    queryKeysSectionSizeClass = 'shrink-0';
  } else if (relatedFilesExpanded) {
    queryKeysSectionSizeClass = 'basis-[50%]';
  }

  let relatedFilesSectionSizeClass = 'grow basis-0';
  if (collapsedSections.relatedFiles) {
    relatedFilesSectionSizeClass = 'shrink-0';
  } else if (queryKeysExpanded) {
    relatedFilesSectionSizeClass = 'basis-[50%]';
  }

  return (
    <aside className="flex h-full w-[var(--rqv-left-width)] min-w-[180px] shrink-0 grow-0 basis-[var(--rqv-left-width)] flex-col overflow-hidden border-r border-zinc-300 bg-zinc-100 p-3 dark:border-zinc-700 dark:bg-zinc-950">
      <section className="mb-4 shrink-0 border-b border-zinc-300/75 pb-[10px] dark:border-zinc-700/70">
        {sectionHeader('Operations', 'operations')}
        {!collapsedSections.operations
          ? LEFT_PANEL_OPERATION_RELATIONS.map((relation) => (
              <label
                key={relation}
                className="my-1 flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-zinc-200/70 dark:hover:bg-zinc-800/70"
              >
                <input type="checkbox" checked={filters.relation[relation]} onChange={() => toggleRelation(relation)} />
                <span
                  aria-hidden
                  className="h-[3px] w-4 shrink-0 rounded-full"
                  style={{ backgroundColor: RELATION_COLOR[relation] }}
                />
                <span
                  className={
                    filters.relation[relation] ? 'text-zinc-800 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'
                  }
                >
                  {RELATION_LABEL[relation]}
                </span>
              </label>
            ))
          : null}
      </section>

      <section className="mb-4 shrink-0 border-b border-zinc-300/75 pb-[10px] dark:border-zinc-700/70">
        {sectionHeader('Filter', 'filters')}
        {!collapsedSections.filters ? (
          <>
            <input
              className="mb-2 w-full rounded-[7px] border border-zinc-300 bg-zinc-100 px-2 py-[7px] text-[12px] text-zinc-700 placeholder:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:placeholder:text-zinc-500"
              value={filters.fileQuery}
              placeholder="Filter files"
              onChange={(event) => setFilters((prev) => ({ ...prev, fileQuery: event.target.value }))}
            />
            <input
              className="mb-2 w-full rounded-[7px] border border-zinc-300 bg-zinc-100 px-2 py-[7px] text-[12px] text-zinc-700 placeholder:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:placeholder:text-zinc-500"
              value={filters.search}
              placeholder="Search labels"
              onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
            />
          </>
        ) : null}
      </section>

      <section className="mb-4 shrink-0 border-b border-zinc-300/75 pb-[10px] dark:border-zinc-700/70">
        {sectionHeader('Layout', 'layout')}
        {!collapsedSections.layout ? (
          <div className="space-y-2 rounded-[7px] border border-zinc-300 px-2 py-1.5 dark:border-zinc-700">
            <div>
              <label
                className="mb-0.5 flex items-center justify-between text-[11px] text-zinc-600 dark:text-zinc-300"
                htmlFor="rqv-vertical-spacing"
              >
                <span>Vertical Spacing</span>
                <span className="font-medium tabular-nums text-zinc-800 dark:text-zinc-100">{verticalSpacing}</span>
              </label>
              <input
                id="rqv-vertical-spacing"
                type="range"
                min={0}
                max={300}
                step={2}
                value={verticalSpacing}
                onChange={(event) => onVerticalSpacingChange(Number(event.target.value))}
                className="h-1.5 w-full cursor-pointer accent-zinc-700 dark:accent-zinc-300"
              />
            </div>

            <div>
              <label
                className="mb-0.5 flex items-center justify-between text-[11px] text-zinc-600 dark:text-zinc-300"
                htmlFor="rqv-horizontal-spacing"
              >
                <span>Horizontal Spacing</span>
                <span className="font-medium tabular-nums text-zinc-800 dark:text-zinc-100">{horizontalSpacing}</span>
              </label>
              <input
                id="rqv-horizontal-spacing"
                type="range"
                min={100}
                max={3000}
                step={25}
                value={horizontalSpacing}
                onChange={(event) => onHorizontalSpacingChange(Number(event.target.value))}
                className="h-1.5 w-full cursor-pointer accent-zinc-700 dark:accent-zinc-300"
              />
            </div>
          </div>
        ) : null}
      </section>

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <section
          className={cx(
            'flex min-h-0 flex-col border-b border-zinc-300/75 pb-[10px] dark:border-zinc-700/70',
            queryKeysSectionSizeClass,
          )}
        >
          {sectionHeader('Current Query Keys', 'queryKeys', String(queryKeys.length))}
          {queryKeysContent}
        </section>

        <section className={cx('mb-0 flex min-h-0 flex-col pb-[10px]', relatedFilesSectionSizeClass)}>
          {sectionHeader('Related Files', 'relatedFiles', String(filteredRelatedFiles.length))}
          {relatedFilesContent}
        </section>
      </div>
    </aside>
  );
}
