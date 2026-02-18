import { Handle, type NodeProps, Position } from '@xyflow/react';

import {
  NODE_SURFACE_CLASS,
  RELATION_BADGE_CLASS,
  RELATION_LABEL,
  SHARED_SOURCE_HANDLE_ID,
  SHARED_TARGET_HANDLE_ID,
  type VisualNodeKind,
} from '../constants';
import { cx, isDeclareActionNode } from '../utils';
import type { FlowNodeData } from '../viewTypes';

const NODE_KIND_LABEL = {
  file: 'File',
  action: 'Action',
  queryKey: 'Query Key',
  declare: 'Declare',
} as const;

export function RqvFlowNode({ data }: NodeProps) {
  const nodeData = data as unknown as FlowNodeData;
  const visualKind: VisualNodeKind = isDeclareActionNode(nodeData.node) ? 'declare' : nodeData.node.kind;

  return (
    <div
      className={cx(
        'h-full min-h-[173px] overflow-hidden rounded-xl border border-transparent p-[11px_11px] shadow-[0_10px_24px_rgba(24,24,27,0.24)] dark:shadow-[0_10px_24px_rgba(0,0,0,0.5)]',
        NODE_SURFACE_CLASS[visualKind],
        nodeData.dim && 'opacity-80',
        nodeData.highlighted &&
          'border-zinc-500 shadow-[0_0_0_1px_rgba(113,113,122,0.45),0_12px_28px_rgba(24,24,27,0.24)] dark:border-zinc-300 dark:shadow-[0_0_0_1px_rgba(212,212,216,0.45),0_12px_28px_rgba(0,0,0,0.58)]',
        nodeData.selected &&
          'border-zinc-600 ring-2 ring-zinc-500 ring-offset-2 ring-offset-zinc-100 shadow-[0_0_0_2px_rgba(82,82,91,0.75),0_16px_34px_rgba(24,24,27,0.3)] dark:border-zinc-200 dark:ring-zinc-300 dark:ring-offset-zinc-950 dark:shadow-[0_0_0_2px_rgba(228,228,231,0.8),0_16px_34px_rgba(0,0,0,0.7)]',
      )}
    >
      <Handle
        id={SHARED_TARGET_HANDLE_ID}
        className="!pointer-events-none !h-[6px] !w-[6px] !rounded-full !border !border-zinc-500 !bg-zinc-300 !opacity-0 dark:!border-zinc-300 dark:!bg-zinc-100"
        type="target"
        position={Position.Left}
        style={{ top: '50%' }}
      />

      <div className="mb-[5px] flex items-center justify-between gap-2">
        <span className="text-[13px] tracking-[0.07em] text-zinc-600 dark:text-zinc-400">
          {NODE_KIND_LABEL[visualKind]}
        </span>
        {nodeData.relation ? (
          <span
            className={cx(
              'rounded-xl px-1.5 py-0.5 text-[13px] font-bold text-white',
              RELATION_BADGE_CLASS[nodeData.relation],
            )}
          >
            {RELATION_LABEL[nodeData.relation]}
          </span>
        ) : null}
      </div>

      <div
        className="mb-1 text-[20px] leading-[1.3] font-bold text-zinc-900 break-words dark:text-zinc-50"
        title={nodeData.title}
      >
        {nodeData.title}
      </div>
      <div
        className="text-[16px] leading-[1.35] text-zinc-700 break-words dark:text-zinc-300"
        title={nodeData.subtitle}
      >
        {nodeData.subtitle}
      </div>

      <Handle
        id={SHARED_SOURCE_HANDLE_ID}
        className="!pointer-events-none !h-[6px] !w-[6px] !rounded-full !border !border-zinc-500 !bg-zinc-300 !opacity-0 dark:!border-zinc-300 dark:!bg-zinc-100"
        type="source"
        position={Position.Right}
        style={{ top: '50%' }}
      />
    </div>
  );
}
