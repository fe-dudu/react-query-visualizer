import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  MAX_LEFT_PANEL,
  MAX_RIGHT_PANEL,
  MIN_CANVAS_WIDTH,
  MIN_LEFT_PANEL,
  MIN_RIGHT_PANEL,
  RESIZER_WIDTH,
} from '../constants';
import { clamp } from '../utils';

export type PanelSide = 'left' | 'right';

interface DragState {
  side: PanelSide;
  startX: number;
  startLeft: number;
  startRight: number;
}

interface ResizablePanelsResult {
  shellRef: React.RefObject<HTMLDivElement | null>;
  shellStyle: CSSProperties;
  activeResizer: PanelSide | null;
  startResize: (side: PanelSide) => (event: ReactPointerEvent<HTMLDivElement>) => void;
}

function maxLeftBySpace(shellWidth: number, rightPanelWidth: number): number {
  return Math.max(MIN_LEFT_PANEL, shellWidth - rightPanelWidth - MIN_CANVAS_WIDTH - RESIZER_WIDTH * 2);
}

function maxRightBySpace(shellWidth: number, leftPanelWidth: number): number {
  return Math.max(MIN_RIGHT_PANEL, shellWidth - leftPanelWidth - MIN_CANVAS_WIDTH - RESIZER_WIDTH * 2);
}

export function useResizablePanels(initialLeft = 280, initialRight = 300): ResizablePanelsResult {
  const [leftPanelWidth, setLeftPanelWidth] = useState(initialLeft);
  const [rightPanelWidth, setRightPanelWidth] = useState(initialRight);
  const leftPanelWidthRef = useRef(leftPanelWidth);
  const rightPanelWidthRef = useRef(rightPanelWidth);
  const [activeResizer, setActiveResizer] = useState<PanelSide | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);

  useEffect(() => {
    leftPanelWidthRef.current = leftPanelWidth;
  }, [leftPanelWidth]);

  useEffect(() => {
    rightPanelWidthRef.current = rightPanelWidth;
  }, [rightPanelWidth]);

  useEffect(() => {
    if (!activeResizer) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!dragStateRef.current || !shellRef.current) {
        return;
      }

      const shellWidth = shellRef.current.clientWidth;
      const { side, startX, startLeft, startRight } = dragStateRef.current;
      const delta = event.clientX - startX;

      if (side === 'left') {
        const nextLeft = clamp(
          startLeft + delta,
          MIN_LEFT_PANEL,
          Math.min(MAX_LEFT_PANEL, maxLeftBySpace(shellWidth, startRight)),
        );
        setLeftPanelWidth(nextLeft);
        return;
      }

      const nextRight = clamp(
        startRight - delta,
        MIN_RIGHT_PANEL,
        Math.min(MAX_RIGHT_PANEL, maxRightBySpace(shellWidth, startLeft)),
      );
      setRightPanelWidth(nextRight);
    };

    const onPointerUp = () => {
      setActiveResizer(null);
      dragStateRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [activeResizer]);

  useEffect(() => {
    const onResize = () => {
      if (!shellRef.current) {
        return;
      }

      const shellWidth = shellRef.current.clientWidth;
      const currentLeft = leftPanelWidthRef.current;
      const currentRight = rightPanelWidthRef.current;

      const nextLeft = clamp(
        currentLeft,
        MIN_LEFT_PANEL,
        Math.min(MAX_LEFT_PANEL, maxLeftBySpace(shellWidth, currentRight)),
      );
      const nextRight = clamp(
        currentRight,
        MIN_RIGHT_PANEL,
        Math.min(MAX_RIGHT_PANEL, maxRightBySpace(shellWidth, nextLeft)),
      );

      if (nextLeft !== currentLeft) {
        leftPanelWidthRef.current = nextLeft;
        setLeftPanelWidth(nextLeft);
      }

      if (nextRight !== currentRight) {
        rightPanelWidthRef.current = nextRight;
        setRightPanelWidth(nextRight);
      }
    };

    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const shellStyle = useMemo(
    () =>
      ({
        '--rqv-left-width': `${leftPanelWidth}px`,
        '--rqv-right-width': `${rightPanelWidth}px`,
      }) as CSSProperties,
    [leftPanelWidth, rightPanelWidth],
  );

  const startResize = (side: PanelSide) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      side,
      startX: event.clientX,
      startLeft: leftPanelWidth,
      startRight: rightPanelWidth,
    };
    setActiveResizer(side);
    event.preventDefault();
  };

  return {
    shellRef,
    shellStyle,
    activeResizer,
    startResize,
  };
}
