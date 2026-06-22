import { describe, expect, it } from 'vitest';

import { clampHorizontalSpacing, clampVerticalSpacing, resolveVerticalRowGap } from '../spacing';

describe('webview/layout/spacing', () => {
  it('clamps spacing values', () => {
    expect(resolveVerticalRowGap(12.4)).toBe(12);
    expect(clampVerticalSpacing(-5)).toBe(0);
    expect(clampVerticalSpacing(301)).toBe(300);
    expect(clampHorizontalSpacing(99)).toBe(100);
    expect(clampHorizontalSpacing(3050)).toBe(3000);
  });
});
