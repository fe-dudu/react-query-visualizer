import assert from 'node:assert/strict';
import test from 'node:test';

import { computeProjectBubbleFrame, computeProjectGridShifts } from '../src/webview/projectLayout';

test('computeProjectGridShifts wraps monorepo projects into multiple rows', () => {
  const shifts = computeProjectGridShifts(
    [
      { project: 'a', minX: 0, maxX: 300, minY: 0, maxY: 200 },
      { project: 'b', minX: 320, maxX: 620, minY: 0, maxY: 180 },
      { project: 'c', minX: 640, maxX: 940, minY: 0, maxY: 220 },
      { project: 'd', minX: 960, maxX: 1260, minY: 0, maxY: 190 },
      { project: 'e', minX: 1280, maxX: 1580, minY: 0, maxY: 210 },
    ],
    {
      columnGap: 100,
      rowGap: 80,
      maxColumns: 4,
    },
  );

  assert.equal(shifts.get('a')?.y, 0);
  assert.equal(shifts.get('d')?.y, 0);
  assert.ok((shifts.get('e')?.y ?? 0) > 0);
});

test('computeProjectGridShifts keeps small project sets on one row', () => {
  const shifts = computeProjectGridShifts(
    [
      { project: 'a', minX: 0, maxX: 300, minY: 10, maxY: 210 },
      { project: 'b', minX: 320, maxX: 620, minY: 40, maxY: 220 },
      { project: 'c', minX: 640, maxX: 940, minY: 20, maxY: 180 },
    ],
    {
      columnGap: 100,
      rowGap: 80,
      maxColumns: 4,
    },
  );

  assert.equal(shifts.get('a')?.y, 0);
  assert.equal(shifts.get('b')?.y, -30);
  assert.equal(shifts.get('c')?.y, -10);
  assert.ok((shifts.get('b')?.x ?? 0) > (shifts.get('a')?.x ?? 0));
});

test('computeProjectBubbleFrame stays close to the actual project bounds', () => {
  const frame = computeProjectBubbleFrame({
    minX: 500,
    maxX: 840,
    minY: 200,
    maxY: 420,
  });

  assert.equal(frame.x, 444);
  assert.equal(frame.y, 128);
  assert.equal(frame.width, 452);
  assert.equal(frame.height, 336);
});

test('computeProjectGridShifts leaves bubble frames separated across wrapped rows', () => {
  const projects = [
    { project: 'a', minX: 0, maxX: 300, minY: 0, maxY: 220 },
    { project: 'b', minX: 320, maxX: 620, minY: 0, maxY: 220 },
    { project: 'c', minX: 640, maxX: 940, minY: 0, maxY: 220 },
    { project: 'd', minX: 960, maxX: 1260, minY: 0, maxY: 220 },
    { project: 'e', minX: 1280, maxX: 1580, minY: 0, maxY: 220 },
  ] as const;
  const shifts = computeProjectGridShifts([...projects], {
    columnGap: 100,
    rowGap: 80,
    maxColumns: 4,
  });

  const frameA = computeProjectBubbleFrame(projects[0]);
  const frameE = computeProjectBubbleFrame(projects[4]);
  const shiftedABottom = frameA.y + (shifts.get('a')?.y ?? 0) + frameA.height;
  const shiftedETop = frameE.y + (shifts.get('e')?.y ?? 0);

  assert.ok(shiftedETop >= shiftedABottom + 80);
});
