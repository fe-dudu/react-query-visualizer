import { describe, expect, it } from 'vitest';

import { clamp, cx, isDeclareActionNode, nodeFileDisplay, shortText } from '../utils';
import type { GraphNode } from '../../../shared/contracts';

describe('webview/utils/utils', () => {
  it('clamps and formats text', () => {
    expect(clamp(12, 0, 10)).toBe(10);
    expect(cx('a', false, null, 'b', undefined, 'c')).toBe('a b c');
    expect(shortText('hello')).toBe('hello');
    expect(shortText('abcdefghijklmnopqrstuvwxyz', 8)).toBe('abcdefg…');
  });

  it('derives file display values and declare action state', () => {
    const fileNode: GraphNode = {
      id: 'file:1',
      kind: 'file',
      label: 'src/file.ts',
      resolution: 'static',
    };
    const actionNode: GraphNode = {
      id: 'action:1',
      kind: 'action',
      label: 'invalidate',
      file: 'src/file.ts',
      resolution: 'static',
      metrics: {
        relation: 'declares',
        displayFile: 'display.ts',
      },
    };

    expect(nodeFileDisplay(fileNode)).toBe('src/file.ts');
    expect(nodeFileDisplay(actionNode)).toBe('display.ts');
    expect(
      nodeFileDisplay({
        id: 'action:2',
        kind: 'action',
        label: 'invalidate',
        file: 'src/fallback.ts',
        resolution: 'static',
        metrics: { relation: 'invalidates' },
      }),
    ).toBe('src/fallback.ts');
    expect(isDeclareActionNode(actionNode)).toBe(true);
    expect(isDeclareActionNode(undefined)).toBe(false);
    expect(isDeclareActionNode({ ...actionNode, kind: 'file' })).toBe(false);
    expect(
      isDeclareActionNode({
        ...actionNode,
        metrics: { relation: 'declares', declaresDirectly: 0 },
      }),
    ).toBe(false);
    expect(
      isDeclareActionNode({
        ...actionNode,
        metrics: { relation: 'declares', declaresDirectly: '2' },
      }),
    ).toBe(true);
    expect(
      isDeclareActionNode({
        ...actionNode,
        metrics: { relation: 'declares', declaresDirectly: Number.POSITIVE_INFINITY },
      }),
    ).toBe(true);
    expect(
      isDeclareActionNode({
        ...actionNode,
        metrics: { relation: 'declares', declaresDirectly: 'unknown' },
      }),
    ).toBe(true);
    expect(
      isDeclareActionNode({
        ...actionNode,
        label: 'useQueryData',
        metrics: { relation: 'declares' },
      }),
    ).toBe(false);
  });
});
