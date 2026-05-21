import type { PointerEvent as ReactPointerEvent } from 'react';

interface ResizeDividerProps {
  hiddenOnSmall?: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function ResizeDivider({ hiddenOnSmall = false, onPointerDown }: ResizeDividerProps) {
  return (
    <div
      className={`h-full w-2 shrink-0 basis-2 cursor-col-resize bg-zinc-500/35 opacity-70 transition-opacity hover:opacity-100 dark:bg-zinc-500/45 ${hiddenOnSmall ? 'max-[900px]:hidden' : ''}`}
      onPointerDown={onPointerDown}
    />
  );
}
