import { describe, expect, it } from 'vitest';

import { makeActionNodeId, makeFileNodeId, makeQueryKeyNodeId } from '../nodeIds';
import { createQueryRecord } from '../../../testing/fixtures';

describe('core/graph/nodeIds', () => {
  it('builds stable ids', () => {
    const record = createQueryRecord({
      relation: 'invalidates',
      operation: 'invalidateQueries',
      file: '/repo/src/file.ts',
      loc: { line: 4, column: 2 },
      queryKey: {
        id: 'todo',
        display: 'todo',
        segments: ['todo'],
        matchMode: 'exact',
        resolution: 'static',
        source: 'literal',
      },
    });

    expect(makeFileNodeId('/repo/src/file.ts')).toBe('file:/repo/src/file.ts');
    expect(makeActionNodeId(record, 3)).toBe('action:/repo/src/file.ts:4:2:invalidateQueries:3');
    expect(makeQueryKeyNodeId('workspace:app', 'todo')).toBe('qk:workspace:app:todo');
  });
});
