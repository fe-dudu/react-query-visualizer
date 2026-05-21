import { vscode } from './vscode';
import type { GraphNode } from '../types/model';
import type { NodeCallsite, NodeFileRef } from '../types/viewTypes';

export function revealNodeInCode(node: GraphNode): void {
  if (!node.file) {
    return;
  }

  vscode?.postMessage({
    type: 'reveal',
    file: node.file,
    line: node.loc?.line ?? 1,
    column: node.loc?.column ?? 1,
  });
}

export function revealCallsiteInCode(callsite: NodeCallsite): void {
  if (!callsite.file) {
    return;
  }

  vscode?.postMessage({
    type: 'reveal',
    file: callsite.file,
    line: callsite.line ?? 1,
    column: callsite.column ?? 1,
  });
}

export function revealFileInCode(fileRef: NodeFileRef): void {
  if (!fileRef.file) {
    return;
  }

  vscode?.postMessage({
    type: 'reveal',
    file: fileRef.file,
    line: fileRef.line ?? 1,
    column: fileRef.column ?? 1,
  });
}
