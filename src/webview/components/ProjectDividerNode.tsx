import type { NodeProps } from '@xyflow/react';

import type { DividerNodeData } from '../viewTypes';

export function ProjectDividerNode({ data }: NodeProps) {
  const dividerData = data as DividerNodeData;
  const width = Number(dividerData.width || 0);
  const height = Number(dividerData.height || 0);
  const showLabel = dividerData.showLabel !== false;
  const variant = dividerData.variant ?? 'line';

  if (variant === 'bubble') {
    return (
      <div
        className="pointer-events-none relative overflow-visible rounded-[28px] border-2 border-dashed border-zinc-500/60 bg-zinc-300/6 dark:border-zinc-400/50 dark:bg-zinc-800/10"
        style={{ width: Math.max(480, width), height: Math.max(140, height) }}
      >
        {showLabel ? (
          <span className="absolute top-4 left-5 rounded bg-zinc-100/96 px-4 py-1.5 text-[18px] leading-none tracking-[0.03em] text-zinc-800 shadow-[0_4px_12px_rgba(24,24,27,0.18)] dark:bg-zinc-900/96 dark:text-zinc-200 dark:shadow-[0_4px_12px_rgba(0,0,0,0.45)]">
            {dividerData.label}
          </span>
        ) : null}
        <span className="absolute inset-0 rounded-[26px] border border-zinc-400/15 dark:border-zinc-500/15" />
      </div>
    );
  }

  return (
    <div className="pointer-events-none relative h-[4px] overflow-visible" style={{ width: Math.max(480, width) }}>
      <div className="absolute -top-8 left-0 h-[4px] w-full border-t-[4px] border-dashed border-zinc-500/80 opacity-95 dark:border-zinc-400/70" />
      {showLabel ? (
        <span className="absolute -top-20 left-0 rounded bg-zinc-100/96 px-3 py-1 text-[40px] leading-none tracking-[0.03em] text-zinc-800 shadow-[0_4px_12px_rgba(24,24,27,0.18)] dark:bg-zinc-900/96 dark:text-zinc-200 dark:shadow-[0_4px_12px_rgba(0,0,0,0.45)]">
          {dividerData.label}
        </span>
      ) : null}
    </div>
  );
}
