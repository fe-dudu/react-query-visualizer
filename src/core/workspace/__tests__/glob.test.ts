import { describe, expect, it } from 'vitest';

import { parseGlobPatterns } from '../glob';

describe('core/workspace/glob', () => {
  it('splits comma separated patterns while preserving brace groups', () => {
    expect(parseGlobPatterns('**/*.ts, **/*.tsx, **/*.{js,jsx}')).toEqual(['**/*.ts', '**/*.tsx', '**/*.{js,jsx}']);
  });

  it('drops empty patterns', () => {
    expect(parseGlobPatterns(' , ,foo,, bar ')).toEqual(['foo', 'bar']);
  });
});
