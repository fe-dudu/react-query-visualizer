import { describe, expect, it, vi } from 'vitest';

const buildGraphInternal = vi.hoisted(() => vi.fn());

vi.mock('../buildGraph', () => ({
  buildGraph: buildGraphInternal,
}));

describe('core/graph/graphBuilder', () => {
  it('forwards to the graph builder implementation', async () => {
    const { buildGraph } = await import('../graphBuilder');

    const roots = [{ name: 'workspace', path: '/repo' }];
    const analysis = {
      records: [],
      scannedFiles: [],
      filesScanned: 0,
      parseErrors: [],
    };

    buildGraph(roots, analysis);

    expect(buildGraphInternal).toHaveBeenCalledWith(roots, analysis);
  });
});
