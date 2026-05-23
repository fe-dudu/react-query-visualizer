declare module '@oxc-parser/binding-wasm32-wasi' {
  export interface OxcParseError {
    codeframe?: string;
    message: string;
  }

  export interface OxcParseComment {
    end: number;
    start: number;
    type: 'Line' | 'Block';
    value?: string;
  }

  export interface OxcParseResult {
    comments: OxcParseComment[];
    errors: OxcParseError[];
    program: unknown;
  }

  export function parseSync(filename: string, sourceText: string, options: unknown): OxcParseResult;
}

declare module 'oxc-parser/src-js/wrap.js' {
  import type { OxcParseResult } from '@oxc-parser/binding-wasm32-wasi';

  export function wrap(value: unknown): OxcParseResult;
}
