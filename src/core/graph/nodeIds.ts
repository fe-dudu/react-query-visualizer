import type { QueryRecord } from '../../shared/types';

export function makeFileNodeId(filePath: string): string {
  return `file:${filePath}`;
}

export function makeActionNodeId(record: QueryRecord, index: number): string {
  return `action:${record.file}:${record.loc.line}:${record.loc.column}:${record.operation}:${index}`;
}

export function makeQueryKeyNodeId(projectScope: string, queryKeyId: string): string {
  return `qk:${projectScope}:${queryKeyId}`;
}
