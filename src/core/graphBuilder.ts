import { buildGraph as buildGraphInternal } from './graphBuilder/buildGraph';
import type { AnalysisResult, GraphData } from '../types';

export interface GraphRoot {
  name: string;
  path: string;
}

export function buildGraph(roots: GraphRoot[], analysis: AnalysisResult): GraphData {
  return buildGraphInternal(roots, analysis);
}
