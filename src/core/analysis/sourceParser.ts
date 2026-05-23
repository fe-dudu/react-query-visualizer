import * as path from 'node:path';
import { parseSync } from '@oxc-parser/binding-wasm32-wasi';
import { wrap } from 'oxc-parser/src-js/wrap.js';

import { type File, type Loc, type Program, isNode, normalizeAstShape } from './ast';

type OxcParseOptions = {
  lang?: 'js' | 'jsx' | 'ts' | 'tsx';
  sourceType: 'unambiguous';
  astType: 'ts';
  range: true;
  preserveParens: true;
  showSemanticErrors: false;
};

type ParseAttempt = {
  lang?: OxcParseOptions['lang'];
};

function inferLang(filePath: string): OxcParseOptions['lang'] | undefined {
  const lower = path.basename(filePath).toLowerCase();
  if (lower.endsWith('.tsx')) {
    return 'tsx';
  }
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) {
    return 'ts';
  }
  if (lower.endsWith('.jsx')) {
    return 'jsx';
  }
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return 'js';
  }

  return undefined;
}

function inferAttemptLangs(filePath: string): OxcParseOptions['lang'][] {
  const primary = inferLang(filePath);
  switch (primary) {
    case 'js':
      return ['js', 'jsx', 'tsx'];
    case 'jsx':
      return ['jsx', 'tsx'];
    case 'ts':
      return ['ts', 'tsx'];
    case 'tsx':
      return ['tsx'];
    default:
      return ['js', 'jsx', 'ts', 'tsx'];
  }
}

function buildParseOptions(attempt: ParseAttempt): OxcParseOptions {
  return {
    lang: attempt.lang,
    sourceType: 'unambiguous',
    astType: 'ts',
    range: true,
    preserveParens: true,
    showSemanticErrors: false,
  };
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
  const normalizedOffset = Math.max(0, offset);
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

function annotateLocs(node: unknown, lineStarts: number[], seen = new WeakSet<object>()): void {
  if (!isNode(node) || seen.has(node)) {
    return;
  }
  seen.add(node);

  const record = node as Record<string, unknown> & {
    loc?: Loc;
    start?: number;
    end?: number;
    parent?: unknown;
  };

  if (!record.loc && typeof record.start === 'number' && typeof record.end === 'number') {
    record.loc = {
      start: offsetToLoc(lineStarts, record.start),
      end: offsetToLoc(lineStarts, record.end),
    };
  }

  for (const [key, value] of Object.entries(record)) {
    if (key === 'loc' || key === 'parent') {
      continue;
    }

    if (Array.isArray(value)) {
      for (const child of value) {
        annotateLocs(child, lineStarts, seen);
      }
      continue;
    }

    annotateLocs(value, lineStarts, seen);
  }
}

function parseWithOxc(raw: string, filePath: string, attempt: ParseAttempt): File {
  const result = wrap(parseSync(filePath, raw, buildParseOptions(attempt)));
  if (result.errors.length > 0) {
    const first = result.errors[0];
    const message = first.codeframe ? first.codeframe : first.message;
    throw new Error(message);
  }

  const program = result.program as Program;
  const lineStarts = buildLineStarts(raw);
  normalizeAstShape(program);
  annotateLocs(program, lineStarts);

  return {
    type: 'File',
    program,
    comments: result.comments.map((comment) => ({
      ...comment,
      value: comment.value ?? '',
      loc: {
        start: offsetToLoc(lineStarts, comment.start),
        end: offsetToLoc(lineStarts, comment.end),
      },
    })),
    tokens: [],
  };
}

export function parseSource(raw: string, filePath: string): File {
  const attempts: ParseAttempt[] = inferAttemptLangs(filePath).map((lang) => ({ lang }));

  let firstError: unknown;

  for (const attempt of attempts) {
    try {
      return parseWithOxc(raw, filePath, attempt);
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
