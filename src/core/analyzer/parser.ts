import type * as t from '@babel/types';
import { type ParserPlugin, parse } from '@babel/parser';

import { PARSER_FLOW_PLUGINS, PARSER_TS_PLUGINS } from './constants';

function parseWith(raw: string, filePath: string, plugins: ParserPlugin[]): t.File {
  return parse(raw, {
    sourceFilename: filePath,
    sourceType: 'unambiguous',
    plugins,
  });
}

export function parseSource(raw: string, filePath: string): t.File {
  try {
    return parseWith(raw, filePath, PARSER_TS_PLUGINS);
  } catch (tsError) {
    try {
      return parseWith(raw, filePath, PARSER_FLOW_PLUGINS);
    } catch {
      throw tsError;
    }
  }
}
