import { describe, expect, it } from 'vitest';

import { parseSource } from '../sourceParser';

describe('core/analysis/sourceParser', () => {
  it('annotates locations for parsed source', () => {
    const file = parseSource(
      ['// leading comment', 'export const value = 1;', 'export function run() {', '  return value;', '}'].join('\n'),
      '/repo/src/value.ts',
    );

    expect(file.comments).toHaveLength(1);
    expect(file.comments[0]?.loc?.start).toEqual({ line: 1, column: 0 });
    expect(file.program.body[0]?.loc?.start).toEqual({ line: 2, column: 0 });
    expect(file.program.body[1]?.loc?.start).toEqual({ line: 3, column: 0 });
  });

  it('falls back to later language attempts for ambiguous files', () => {
    const file = parseSource(
      ['const view = <div />;', 'export const count: number = 1;'].join('\n'),
      '/repo/src/view.js',
    );

    expect(file.program.body.length).toBeGreaterThan(0);

    expect(parseSource('export const view = <span />;', '/repo/src/view.tsx').program.body).toHaveLength(1);
    expect(parseSource('export const view = <span />;', '/repo/src/view.jsx').program.body).toHaveLength(1);
    expect(parseSource('export const value: number = 1;', '/repo/src/unknown').program.body).toHaveLength(1);
    expect(parseSource('export const value: number = 1;', '/repo/src/value.mts').program.body).toHaveLength(1);
    expect(parseSource('export const value: number = 1;', '/repo/src/value.cts').program.body).toHaveLength(1);
    expect(parseSource('export const value = 1;', '/repo/src/value.mjs').program.body).toHaveLength(1);
    expect(parseSource('export const value = 1;', '/repo/src/value.cjs').program.body).toHaveLength(1);
  });

  it('throws the first parse error when all attempts fail', () => {
    expect(() => parseSource('export const = ;', '/repo/src/broken.ts')).toThrow();
  });
});
