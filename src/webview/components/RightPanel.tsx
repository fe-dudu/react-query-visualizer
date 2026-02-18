import type { GraphNode } from '../model';
import { isDeclareActionNode, nodeFileDisplay } from '../utils';
import type { NodeCallsite, NodeExplanation, NodeFileRef } from '../viewTypes';

interface RightPanelProps {
  selectedNode: GraphNode | null;
  explanation: NodeExplanation | null;
  onReveal: (node: GraphNode) => void;
  onRevealFile: (fileRef: NodeFileRef) => void;
  onRevealCallsite: (callsite: NodeCallsite) => void;
}

interface DetailFieldProps {
  label: string;
  value: string;
  withBorder?: boolean;
}

function nodeType(node: GraphNode): string {
  if (isDeclareActionNode(node)) {
    return 'declare';
  }

  return node.kind;
}

function DetailField({ label, value, withBorder = true }: DetailFieldProps) {
  return (
    <div className={withBorder ? 'mt-2 min-w-0 border-t border-zinc-300/75 pt-2 dark:border-zinc-700/70' : 'min-w-0'}>
      <span className="mb-1 block text-[10px] tracking-[0.06em] text-zinc-500 dark:text-zinc-400">{label}</span>
      <p className="m-0 max-w-full text-[12.5px] leading-[1.4] text-zinc-800 break-all dark:text-zinc-100">{value}</p>
    </div>
  );
}

interface DetailListProps {
  title: string;
  values: string[];
}

function DetailList({ title, values }: DetailListProps) {
  return (
    <>
      <h4 className="mt-[10px] mb-[6px] text-[11px] tracking-[0.06em] text-zinc-600 dark:text-zinc-300">{title}</h4>
      <ul className="mb-2 ml-0 w-full list-disc overflow-hidden pl-4 text-xs text-zinc-500 dark:text-zinc-400">
        {values.slice(0, 12).map((value) => (
          <li key={value} className="mb-1 max-w-full break-all">
            {value}
          </li>
        ))}
      </ul>
    </>
  );
}

interface CallsiteListProps {
  title: string;
  values: NodeCallsite[];
  onRevealCallsite: (callsite: NodeCallsite) => void;
}

function CallsiteList({ title, values, onRevealCallsite }: CallsiteListProps) {
  return (
    <>
      <h4 className="mt-[10px] mb-[6px] text-[11px] tracking-[0.06em] text-zinc-600 dark:text-zinc-300">{title}</h4>
      <ul className="mb-2 ml-0 w-full list-disc overflow-hidden pl-4 text-xs text-zinc-500 dark:text-zinc-400">
        {values.slice(0, 16).map((callsite, index) => {
          const clickable = Boolean(callsite.file);
          const key = `${callsite.label}:${callsite.file ?? 'unknown'}:${callsite.line ?? 0}:${callsite.column ?? 0}:${index}`;

          return (
            <li key={key} className="mb-1 max-w-full break-all">
              {clickable ? (
                <button
                  type="button"
                  className="cursor-pointer rounded px-1 py-0.5 text-left text-zinc-700 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-50"
                  onClick={() => onRevealCallsite(callsite)}
                >
                  {callsite.label}
                </button>
              ) : (
                <span>{callsite.label}</span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

interface FileListProps {
  values: NodeFileRef[];
  onRevealFile: (fileRef: NodeFileRef) => void;
}

function FileList({ values, onRevealFile }: FileListProps) {
  return (
    <>
      <h4 className="mt-[10px] mb-[6px] text-[11px] tracking-[0.06em] text-zinc-600 dark:text-zinc-300">
        Files involved
      </h4>
      <ul className="mb-2 ml-0 w-full list-disc overflow-hidden pl-4 text-xs text-zinc-500 dark:text-zinc-400">
        {values.slice(0, 16).map((fileRef, index) => {
          const clickable = Boolean(fileRef.file);
          const key = `${fileRef.label}:${fileRef.file ?? 'unknown'}:${fileRef.line ?? 0}:${fileRef.column ?? 0}:${index}`;

          return (
            <li key={key} className="mb-1 max-w-full break-all">
              {clickable ? (
                <button
                  type="button"
                  className="cursor-pointer rounded px-1 py-0.5 text-left text-zinc-700 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-50"
                  onClick={() => onRevealFile(fileRef)}
                >
                  {fileRef.label}
                </button>
              ) : (
                <span>{fileRef.label}</span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function RightPanel({ selectedNode, explanation, onReveal, onRevealFile, onRevealCallsite }: RightPanelProps) {
  return (
    <aside className="w-[var(--rqv-right-width)] min-w-[150px] shrink-0 grow-0 basis-[var(--rqv-right-width)] overflow-y-auto overflow-x-hidden border-l border-zinc-300 bg-zinc-100 p-3 text-xs dark:border-zinc-700 dark:bg-zinc-950 max-[900px]:hidden">
      <h3 className="mb-[10px] text-[13px] tracking-[0.05em] text-zinc-600 dark:text-zinc-300">Details</h3>

      {!selectedNode ? <p className="m-0 text-zinc-500 dark:text-zinc-400">Select a node.</p> : null}

      {selectedNode ? (
        <>
          <div className="mb-[10px] rounded-[10px] border border-zinc-300 bg-zinc-100 p-[10px] dark:border-zinc-700 dark:bg-zinc-900">
            <DetailField label="Type" value={nodeType(selectedNode)} withBorder={false} />
            <DetailField label="Label" value={selectedNode.label} />
            <DetailField label="Resolution" value={selectedNode.resolution} />

            {selectedNode.file ? <DetailField label="File" value={nodeFileDisplay(selectedNode)} /> : null}

            {selectedNode.file && nodeFileDisplay(selectedNode) !== selectedNode.file ? (
              <DetailField label="Path" value={selectedNode.file} />
            ) : null}

            {selectedNode.loc ? (
              <DetailField label="Location" value={`${selectedNode.loc.line}:${selectedNode.loc.column}`} />
            ) : null}
          </div>

          {selectedNode.file ? (
            <button
              className="mb-2 w-full cursor-pointer rounded-lg border border-zinc-400 bg-zinc-200 px-[10px] py-2 text-xs text-zinc-900 hover:bg-zinc-300 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
              type="button"
              onClick={() => onReveal(selectedNode)}
            >
              Open in code
            </button>
          ) : null}

          {explanation ? (
            <>
              <h4 className="mt-[10px] mb-[6px] text-[11px] tracking-[0.06em] text-zinc-600 dark:text-zinc-300">
                Overview
              </h4>
              <p className="mb-2 max-w-full rounded-lg border border-zinc-300 bg-zinc-100 p-2 leading-[1.4] text-zinc-700 break-all dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                {explanation.summary}
              </p>

              <FileList values={explanation.files} onRevealFile={onRevealFile} />
              <CallsiteList title="Callsites" values={explanation.actions} onRevealCallsite={onRevealCallsite} />
              {explanation.declarations.length > 0 ? (
                <CallsiteList
                  title="Declared in"
                  values={explanation.declarations}
                  onRevealCallsite={onRevealCallsite}
                />
              ) : null}
              <DetailList title="Related query keys" values={explanation.queryKeys} />
            </>
          ) : null}
        </>
      ) : null}
    </aside>
  );
}
