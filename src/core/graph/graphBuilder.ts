import { buildGraph as buildGraphInternal } from './buildGraph';
import type { AnalysisResult, GraphData } from '../../shared/types';
import type { GraphRoot } from './graphBuilderTypes';

export type { GraphRoot } from './graphBuilderTypes';

export function buildGraph(roots: GraphRoot[], analysis: AnalysisResult): GraphData {
  return buildGraphInternal(roots, analysis);
}
