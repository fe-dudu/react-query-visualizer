import type { GraphNode, ScannedFile, WebviewPayload } from '../../shared/contracts';
import { depthFromPath, inferProjectFromPath, makeProjectRelativePath, parseProjectScope } from '../../shared/path';

export function buildRelatedFiles(
  allScannedFiles: ScannedFile[],
  visibleGraph: WebviewPayload['graph'],
): ScannedFile[] {
  const fileByPath = new Map(allScannedFiles.map((file) => [file.path, file]));
  const workspaceCount = new Set(allScannedFiles.map((file) => file.workspace).filter(Boolean)).size;
  const multiWorkspace = workspaceCount > 1;
  const fileNodes = visibleGraph.nodes.filter((node): node is GraphNode => node.kind === 'file');

  return fileNodes
    .map((fileNode) => {
      const matched = fileByPath.get(fileNode.label);
      const workspace = matched?.workspace ?? '';
      const parsedScope = parseProjectScope(fileNode.metrics?.projectScope);
      const baseProject = parsedScope?.project ?? inferProjectFromPath(fileNode.label, workspace);
      const scopedProject = multiWorkspace && workspace ? `${workspace}/${baseProject}` : baseProject;
      const impact = Number(fileNode.metrics?.affectedKeys ?? 0);

      return {
        path: fileNode.label,
        workspace,
        depth: matched?.depth ?? depthFromPath(fileNode.label),
        impact,
        project: scopedProject,
        projectRelativePath: makeProjectRelativePath(fileNode.label, workspace, baseProject),
      } satisfies ScannedFile;
    })
    .sort(
      (a, b) =>
        (a.project ?? '').localeCompare(b.project ?? '') ||
        Number(b.impact ?? 0) - Number(a.impact ?? 0) ||
        a.path.localeCompare(b.path),
    );
}
