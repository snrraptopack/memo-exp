import { print } from 'esrap';
import tsx from 'esrap/languages/tsx';
import type { AstComment } from './parser';
import type { BaseNode } from './types';

export interface PrintEstreeOptions {
  quotes?: 'double' | 'single';
  indent?: string;
  sourceMapSource?: string;
  sourceMapContent?: string;
  comments?: readonly AstComment[];
}

export interface EstreeSourceMap {
  version: 3;
  names: string[];
  sources: Array<string | null>;
  sourcesContent: Array<string | null>;
  mappings: string;
}

export interface PrintedEstree {
  code: string;
  map: EstreeSourceMap | null;
}

function sourceMap(value: unknown): EstreeSourceMap {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('ESTree printer returned an invalid source map');
  }
  const map = value as Record<string, unknown>;
  if (
    map.version !== 3 ||
    !Array.isArray(map.names) ||
    !Array.isArray(map.sources) ||
    !Array.isArray(map.sourcesContent) ||
    typeof map.mappings !== 'string'
  ) {
    throw new TypeError('ESTree printer returned an invalid source map');
  }
  return {
    version: 3,
    names: map.names.filter((name): name is string => typeof name === 'string'),
    sources: map.sources.map((source) =>
      typeof source === 'string' ? source : null,
    ),
    sourcesContent: map.sourcesContent.map((content) =>
      typeof content === 'string' ? content : null,
    ),
    mappings: map.mappings,
  };
}

/** Print an ESTree/TS-ESTree tree without converting it to another AST dialect. */
export function printEstree(
  program: BaseNode,
  options: PrintEstreeOptions = {},
): PrintedEstree {
  const result = print(
    program,
    tsx({
      quotes: options.quotes,
      comments: options.comments === undefined ? undefined : [...options.comments],
    }),
    {
      ...(options.indent === undefined ? {} : { indent: options.indent }),
      ...(options.sourceMapSource === undefined
        ? {}
        : { sourceMapSource: options.sourceMapSource }),
      ...(options.sourceMapContent === undefined
        ? {}
        : { sourceMapContent: options.sourceMapContent }),
    },
  );
  return {
    code: result.code,
    map: options.sourceMapSource === undefined ? null : sourceMap(result.map),
  };
}
