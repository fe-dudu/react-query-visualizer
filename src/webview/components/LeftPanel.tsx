import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from 'react';

import { LeftPanelQueryKeys } from './LeftPanelQueryKeys';
import { LeftPanelRelatedFiles } from './LeftPanelRelatedFiles';
import type { OperationRelation, ScannedFile } from '../../shared/contracts';
import type { FilterState } from '../types/viewTypes';
import { OPERATION_RELATIONS, RELATION_COLOR, RELATION_LABEL } from '../utils/constants';
import {
  applyFilterDraft,
  buildFilterDraft,
  hasPendingFilterChanges,
  hasPendingOperationChanges,
  hasPendingTextFilterChanges,
} from '../utils/filterDraft';
import { buildFileTree, collectDirectoryPaths } from '../utils/leftPanelTree';
import { cx } from '../utils/utils';

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
  const [draftFilters, setDraftFilters] = useState(() => buildFilterDraft(filters));
  const [draftVerticalSpacing, setDraftVerticalSpacing] = useState(verticalSpacing);
  const [draftHorizontalSpacing, setDraftHorizontalSpacing] = useState(horizontalSpacing);

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

  useEffect(() => {
    setDraftFilters({
      relation: { ...filters.relation },
      fileQuery: filters.fileQuery,
      search: filters.search,
    });
  }, [filters.relation, filters.fileQuery, filters.search]);

  useEffect(() => {
    setDraftVerticalSpacing(verticalSpacing);
  }, [verticalSpacing]);

  useEffect(() => {
    setDraftHorizontalSpacing(horizontalSpacing);
  }, [horizontalSpacing]);

  const toggleRelation = (relation: OperationRelation) => {
    setDraftFilters((prev) => ({
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

  const applyDraftFilters = () => {
    if (!hasPendingFilterChanges(filters, draftFilters)) {
      return;
    }

    setFilters((previous) => applyFilterDraft(previous, draftFilters));
  };

  const hasPendingOperations = hasPendingOperationChanges(filters, draftFilters);
  const hasPendingTextFilters = hasPendingTextFilterChanges(filters, draftFilters);

  const hasPendingLayoutChanges =
    draftVerticalSpacing !== verticalSpacing || draftHorizontalSpacing !== horizontalSpacing;

  const applyDraftLayout = () => {
    if (!hasPendingLayoutChanges) {
      return;
    }

    onVerticalSpacingChange(draftVerticalSpacing);
    onHorizontalSpacingChange(draftHorizontalSpacing);
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

  const queryKeysContent = !collapsedSections.queryKeys ? (
    <LeftPanelQueryKeys queryKeys={queryKeys} selectedQueryKey={selectedQueryKey} onSelectQueryKey={onSelectQueryKey} />
  ) : null;

  const relatedFilesContent = !collapsedSections.relatedFiles ? (
    <LeftPanelRelatedFiles
      relatedFiles={filteredRelatedFiles}
      fileQuery={filters.fileQuery}
      selectedRelatedFilePath={selectedRelatedFilePath}
      onSelectRelatedFile={onSelectRelatedFile}
      showProjectDividers={showProjectDividers}
      collapsedDirectories={collapsedDirectories}
      setCollapsedDirectories={setCollapsedDirectories}
    />
  ) : null;

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
                <input
                  type="checkbox"
                  checked={draftFilters.relation[relation]}
                  onChange={() => toggleRelation(relation)}
                />
                <span
                  aria-hidden
                  className="h-[3px] w-4 shrink-0 rounded-full"
                  style={{ backgroundColor: RELATION_COLOR[relation] }}
                />
                <span
                  className={
                    draftFilters.relation[relation]
                      ? 'text-zinc-800 dark:text-zinc-100'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }
                >
                  {RELATION_LABEL[relation]}
                </span>
              </label>
            )).concat(
              <button
                key="apply-operations"
                type="button"
                className={cx(
                  'mt-2 w-full rounded-[7px] border px-2 py-[7px] text-[12px] font-medium transition-colors',
                  hasPendingOperations
                    ? 'border-zinc-500 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 dark:border-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200'
                    : 'cursor-not-allowed border-zinc-300 bg-zinc-200/80 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500',
                )}
                onClick={applyDraftFilters}
                disabled={!hasPendingOperations}
              >
                Apply Operations
              </button>,
            )
          : null}
      </section>

      <section className="mb-4 shrink-0 border-b border-zinc-300/75 pb-[10px] dark:border-zinc-700/70">
        {sectionHeader('Filter', 'filters')}
        {!collapsedSections.filters ? (
          <>
            <input
              className="mb-2 w-full rounded-[7px] border border-zinc-300 bg-zinc-100 px-2 py-[7px] text-[12px] text-zinc-700 placeholder:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:placeholder:text-zinc-500"
              value={draftFilters.fileQuery}
              placeholder="Filter files"
              onChange={(event) => setDraftFilters((previous) => ({ ...previous, fileQuery: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  applyDraftFilters();
                }
              }}
            />
            <input
              className="mb-2 w-full rounded-[7px] border border-zinc-300 bg-zinc-100 px-2 py-[7px] text-[12px] text-zinc-700 placeholder:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:placeholder:text-zinc-500"
              value={draftFilters.search}
              placeholder="Search labels"
              onChange={(event) => setDraftFilters((previous) => ({ ...previous, search: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  applyDraftFilters();
                }
              }}
            />
            <button
              type="button"
              className={cx(
                'w-full rounded-[7px] border px-2 py-[7px] text-[12px] font-medium transition-colors',
                hasPendingTextFilters
                  ? 'border-zinc-500 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 dark:border-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200'
                  : 'cursor-not-allowed border-zinc-300 bg-zinc-200/80 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500',
              )}
              onClick={applyDraftFilters}
              disabled={!hasPendingTextFilters}
            >
              Apply Filters
            </button>
          </>
        ) : null}
      </section>

      <section className="mb-4 shrink-0 border-b border-zinc-300/75 pb-[10px] dark:border-zinc-700/70">
        {sectionHeader('Layout', 'layout')}
        {!collapsedSections.layout ? (
          <div className="space-y-2 px-2 py-1.5">
            <div>
              <label
                className="mb-0.5 flex items-center justify-between text-[11px] text-zinc-600 dark:text-zinc-300"
                htmlFor="rqv-vertical-spacing"
              >
                <span>Vertical Spacing</span>
                <span className="font-medium tabular-nums text-zinc-800 dark:text-zinc-100">
                  {draftVerticalSpacing}
                </span>
              </label>
              <input
                id="rqv-vertical-spacing"
                type="range"
                min={0}
                max={300}
                step={2}
                value={draftVerticalSpacing}
                onChange={(event) => setDraftVerticalSpacing(Number(event.target.value))}
                className="h-1.5 w-full cursor-pointer accent-zinc-700 dark:accent-zinc-300"
              />
            </div>

            <div>
              <label
                className="mb-0.5 flex items-center justify-between text-[11px] text-zinc-600 dark:text-zinc-300"
                htmlFor="rqv-horizontal-spacing"
              >
                <span>Horizontal Spacing</span>
                <span className="font-medium tabular-nums text-zinc-800 dark:text-zinc-100">
                  {draftHorizontalSpacing}
                </span>
              </label>
              <input
                id="rqv-horizontal-spacing"
                type="range"
                min={100}
                max={3000}
                step={25}
                value={draftHorizontalSpacing}
                onChange={(event) => setDraftHorizontalSpacing(Number(event.target.value))}
                className="h-1.5 w-full cursor-pointer accent-zinc-700 dark:accent-zinc-300"
              />
            </div>

            <button
              type="button"
              className={cx(
                'w-full rounded-[7px] border px-2 py-[7px] text-[12px] font-medium transition-colors',
                hasPendingLayoutChanges
                  ? 'border-zinc-500 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 dark:border-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200'
                  : 'cursor-not-allowed border-zinc-300 bg-zinc-200/80 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500',
              )}
              onClick={applyDraftLayout}
              disabled={!hasPendingLayoutChanges}
            >
              Apply Layout
            </button>
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
