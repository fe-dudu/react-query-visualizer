import { describe, expect, it } from 'vitest';

import { computeProjectBubbleFrame, computeProjectGridShifts } from '../projectLayout';

describe('webview/layout/projectLayout', () => {
  it('computes bubble frames and grid shifts', () => {
    expect(
      computeProjectBubbleFrame({
        minX: 10,
        maxX: 30,
        minY: 20,
        maxY: 50,
      }),
    ).toEqual({ x: -46, y: -52, width: 420, height: 220 });

    const shifts = computeProjectGridShifts(
      [
        { project: 'a', minX: 0, maxX: 100, minY: 0, maxY: 50 },
        { project: 'b', minX: 200, maxX: 300, minY: 10, maxY: 70 },
        { project: 'c', minX: 400, maxX: 500, minY: 20, maxY: 80 },
      ],
      { columnGap: 16, rowGap: 20, maxColumns: 2 },
    );

    expect(shifts.size).toBe(3);
    expect(shifts.get('a')).toEqual({ x: 0, y: 0 });
    expect(shifts.get('b')).toEqual({ x: 236, y: -10 });
    expect(computeProjectGridShifts([], { columnGap: 16, rowGap: 20, maxColumns: 2 })).toEqual(new Map());
    expect(
      computeProjectGridShifts(
        [
          { project: 'nan-a', minX: Number.NaN, maxX: 100, minY: 0, maxY: 50 },
          { project: 'nan-b', minX: 200, maxX: 300, minY: 10, maxY: 70 },
        ],
        { columnGap: 16, rowGap: 20, maxColumns: 2 },
      ),
    ).toEqual(new Map());
    expect(
      computeProjectBubbleFrame(
        {
          minX: 10,
          maxX: 15,
          minY: 20,
          maxY: 30,
        },
        { horizontalPadding: 8, topPadding: 4, bottomPadding: 2, minWidth: 12, minHeight: 14 },
      ),
    ).toEqual({ x: 2, y: 16, width: 21, height: 16 });
  });

  it('sorts projects by minY when minX is equal, and by label when both are equal', () => {
    // Three projects with equal minX — sort falls through to minY comparison.
    // Two projects with equal minX and minY — sort falls through to label comparison.
    const shifts = computeProjectGridShifts(
      [
        // same minX, different minY — should sort by minY
        { project: 'z-high', minX: 0, maxX: 100, minY: 100, maxY: 150 },
        { project: 'a-low', minX: 0, maxX: 100, minY: 0, maxY: 50 },
        // same minX AND minY — sort by label
        { project: 'z-same', minX: 0, maxX: 100, minY: 200, maxY: 250 },
        { project: 'a-same', minX: 0, maxX: 100, minY: 200, maxY: 250 },
      ],
      { columnGap: 0, rowGap: 0, maxColumns: 1 },
    );

    expect(shifts.size).toBe(4);
    // All four projects should have computed shifts.
    expect(shifts.has('z-high')).toBe(true);
    expect(shifts.has('a-low')).toBe(true);
    expect(shifts.has('z-same')).toBe(true);
    expect(shifts.has('a-same')).toBe(true);
    // 'a-low' (minY=0) comes before 'z-high' (minY=100) in sorted order,
    // so 'a-low' gets the first (lowest) cursorY and 'z-high' gets a larger y.
    const aLow = shifts.get('a-low');
    const zHigh = shifts.get('z-high');
    if (!aLow || !zHigh) {
      throw new Error('Missing shifts');
    }
    expect(aLow.y).toBeLessThanOrEqual(zHigh.y);
  });
});
