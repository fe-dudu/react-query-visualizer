import type * as t from '@babel/types';
import * as path from 'node:path';
import { type ParseOptions, parseSync } from '@swc/wasm';

import { normalizeSwcNodeShape } from './astTraverse';

type ParserSyntax = 'typescript' | 'flow';

interface ParseAttempt {
  syntax: ParserSyntax;
  script: boolean;
  jsx: boolean;
}

const SWC_TARGET: ParseOptions['target'] = 'es2020';

function usesJsxSyntax(filePath: string): boolean {
  const lower = path.basename(filePath).toLowerCase();
  return lower.endsWith('.tsx') || lower.endsWith('.jsx');
}

function buildParseOptions(attempt: ParseAttempt): ParseOptions {
  if (attempt.syntax === 'typescript') {
    return {
      syntax: 'typescript',
      tsx: attempt.jsx,
      decorators: true,
      dynamicImport: true,
      script: attempt.script,
      comments: true,
      target: SWC_TARGET,
    };
  }

  return {
    syntax: 'flow',
    jsx: attempt.jsx,
    decorators: true,
    dynamicImport: true,
    script: attempt.script,
    comments: true,
    target: SWC_TARGET,
  } as unknown as ParseOptions;
}

function buildLineStarts(raw: string): number[] {
  const starts = [0];
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === '\n') {
      starts.push(index + 1);
    }
  }
  return starts;
}

function offsetToLoc(lineStarts: number[], offset: number): { line: number; column: number } {
  const normalizedOffset = Math.max(0, offset - 1);
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= normalizedOffset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const lineIndex = Math.max(0, high);
  return {
    line: lineIndex + 1,
    column: normalizedOffset - lineStarts[lineIndex],
  };
}

function annotateLocs(node: unknown, lineStarts: number[]): void {
  if (!node || typeof node !== 'object') {
    return;
  }

  const record = node as {
    type?: unknown;
    span?: { start: number; end: number };
    loc?: unknown;
    [key: string]: unknown;
  };

  if (typeof record.type !== 'string') {
    return;
  }

  if (!record.loc && record.span && typeof record.span.start === 'number' && typeof record.span.end === 'number') {
    record.loc = {
      start: offsetToLoc(lineStarts, record.span.start),
      end: offsetToLoc(lineStarts, record.span.end),
    };
  }

  for (const [key, value] of Object.entries(record)) {
    if (
      key === 'type' ||
      key === 'span' ||
      key === 'loc' ||
      key === 'start' ||
      key === 'end' ||
      key === 'raw' ||
      key === 'ctxt' ||
      key === 'comments' ||
      key === 'leadingComments' ||
      key === 'innerComments' ||
      key === 'trailingComments'
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const child of value) {
        annotateLocs(child, lineStarts);
      }
      continue;
    }

    annotateLocs(value, lineStarts);
  }
}

function parseWithSwc(raw: string, attempt: ParseAttempt): t.File {
  const swcAst = parseSync(raw, buildParseOptions(attempt));
  const lineStarts = buildLineStarts(raw);
  annotateLocs(swcAst, lineStarts);
  normalizeSwcNodeShape(swcAst as unknown as t.Node);
  annotateLocs(swcAst, lineStarts);
  const program = swcAst as unknown as t.Program;
  program.type = 'Program';
  program.sourceType = attempt.script ? 'script' : 'module';

  return {
    type: 'File',
    program,
    comments: [],
    tokens: [],
  } as unknown as t.File;
}

export function parseSource(raw: string, filePath: string): t.File {
  const jsxPreferred = usesJsxSyntax(filePath);
  const primaryJsx = jsxPreferred;
  const secondaryJsx = !jsxPreferred;
  const attempts: ParseAttempt[] = [
    { syntax: 'typescript', script: false, jsx: primaryJsx },
    { syntax: 'typescript', script: true, jsx: primaryJsx },
    { syntax: 'flow', script: false, jsx: primaryJsx },
    { syntax: 'flow', script: true, jsx: primaryJsx },
    { syntax: 'typescript', script: false, jsx: secondaryJsx },
    { syntax: 'typescript', script: true, jsx: secondaryJsx },
    { syntax: 'flow', script: false, jsx: secondaryJsx },
    { syntax: 'flow', script: true, jsx: secondaryJsx },
  ];

  let firstError: unknown;

  for (const attempt of attempts) {
    try {
      return parseWithSwc(raw, attempt);
    } catch (error) {
      if (firstError === undefined) {
        firstError = error;
      }
    }
  }

  if (firstError instanceof Error) {
    throw firstError;
  }

  throw new Error(`Failed to parse ${filePath}`);
}
