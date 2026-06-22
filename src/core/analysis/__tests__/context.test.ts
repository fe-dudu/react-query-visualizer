import { describe, expect, it } from 'vitest';

import { createParseContext, getCertainty, isQueryLikeModule, mergeResolution, setCertainty } from '../context';

describe('core/analysis/context', () => {
  it('creates an empty parse context', () => {
    const context = createParseContext();
    expect(context.queryHooks.size).toBe(0);
    expect(context.refetchFnQueryKeys.size).toBe(0);
    expect(context.refetchObjectNames.size).toBe(0);
  });

  it('keeps static certainty sticky and merges resolution conservatively', () => {
    const map = new Map<string, 'static' | 'dynamic'>();
    setCertainty(map, 'a', 'dynamic');
    expect(getCertainty(map, 'a')).toBe('dynamic');

    setCertainty(map, 'a', 'static');
    expect(getCertainty(map, 'a')).toBe('static');

    setCertainty(map, 'a', 'dynamic');
    expect(getCertainty(map, 'a')).toBe('static');

    setCertainty(map, 'b', 'dynamic');
    setCertainty(map, 'b', 'dynamic');
    expect(getCertainty(map, 'b')).toBe('dynamic');

    expect(mergeResolution('static', 'static')).toBe('static');
    expect(mergeResolution('dynamic', 'static')).toBe('dynamic');
  });

  it('detects query-like modules', () => {
    expect(isQueryLikeModule('@tanstack/react-query')).toBe(true);
    expect(isQueryLikeModule('feature/query-key')).toBe(true);
    expect(isQueryLikeModule('react-query-visualizer')).toBe(true);
    expect(isQueryLikeModule('lodash')).toBe(false);
  });
});
