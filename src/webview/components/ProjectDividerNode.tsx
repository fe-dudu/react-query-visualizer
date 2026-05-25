import type { NodeProps } from '@xyflow/react';

import type { DividerNodeData } from '../types/viewTypes';

export function ProjectDividerNode({ data }: NodeProps) {
  const dividerData = data as DividerNodeData;
  const width = Number(dividerData.width || 0);
  const height = Number(dividerData.height || 0);
  const showLabel = dividerData.showLabel !== false;
  const variant = dividerData.variant ?? 'line';

  if (variant === 'bubble') {
    return (
      <div
        className="pointer-events-none relative overflow-visible rounded-[28px] border-2 border-dashed border-zinc-600/70 bg-zinc-500/4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)] dark:border-zinc-300/70 dark:bg-zinc-400/5 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
        style={{ width: Math.max(360, width), height: Math.max(140, height) }}
      >
        {showLabel ? (
          <span className="absolute top-4 left-5 rounded border border-zinc-400/45 bg-zinc-100/98 px-3.5 py-1.5 text-[18px] leading-none tracking-[0.03em] text-zinc-800 shadow-[0_2px_8px_rgba(24,24,27,0.12)] dark:border-zinc-500/45 dark:bg-zinc-900/98 dark:text-zinc-200 dark:shadow-[0_2px_8px_rgba(0,0,0,0.28)]">
            {dividerData.label}
          </span>
        ) : null}
        <span className="absolute inset-0 rounded-[26px] border border-zinc-500/18 dark:border-zinc-400/14" />
      </div>
    );
  }

  return (
    <div className="pointer-events-none relative h-[4px] overflow-visible" style={{ width: Math.max(480, width) }}>
      <div className="absolute -top-8 left-0 h-[3px] w-full border-t-[3px] border-dashed border-zinc-600/75 opacity-100 dark:border-zinc-300/70" />
      {showLabel ? (
        <span className="absolute -top-20 left-0 rounded border border-zinc-400/45 bg-zinc-100/98 px-3 py-1 text-[40px] leading-none tracking-[0.03em] text-zinc-800 shadow-[0_2px_8px_rgba(24,24,27,0.12)] dark:border-zinc-500/45 dark:bg-zinc-900/98 dark:text-zinc-200 dark:shadow-[0_2px_8px_rgba(0,0,0,0.28)]">
          {dividerData.label}
        </span>
      ) : null}
    </div>
  );
}
