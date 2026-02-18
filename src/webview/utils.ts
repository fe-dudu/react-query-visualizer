import type { GraphNode } from './model';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function shortText(value: string, max = 64): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function nodeFileDisplay(node: GraphNode): string {
  if (node.kind === 'file') {
    return node.label;
  }

  const metricValue = node.metrics?.displayFile;
  if (typeof metricValue === 'string' && metricValue.length > 0) {
    return metricValue;
  }

  return node.file ?? '';
}

function metricAsNumber(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function isDeclareActionNode(node: GraphNode | undefined): node is GraphNode & { kind: 'action' } {
  if (!node || node.kind !== 'action' || node.metrics?.relation !== 'declares') {
    return false;
  }

  const directMetric = metricAsNumber(node.metrics?.declaresDirectly);
  if (typeof directMetric === 'number') {
    return directMetric > 0;
  }

  // Backward compatibility for payloads created before declaresDirectly existed.
  return !/^use[A-Z]/.test(node.label);
}
