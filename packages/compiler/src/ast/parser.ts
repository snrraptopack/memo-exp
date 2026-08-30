import { parseSync } from 'oxc-parser';
import type { BaseNode, SourceLocation } from './types';

export type AstLanguage = 'js' | 'jsx' | 'ts' | 'tsx' | 'dts';
export type AstSourceType = 'script' | 'module' | 'commonjs' | 'unambiguous';

export interface ParsedProgram extends BaseNode {
  type: 'Program';
  body: BaseNode[];
  sourceType: 'script' | 'module' | 'commonjs';
  hashbang?: BaseNode | null;
}

export interface AstComment {
  type: 'Line' | 'Block';
  value: string;
  start: number;
  end: number;
  loc: SourceLocation;
}

export interface AstDiagnosticLabel {
  message: string | null;
  start: number;
  end: number;
}

export interface AstDiagnostic {
  severity: 'Error' | 'Warning' | 'Advice';
  message: string;
  labels: AstDiagnosticLabel[];
  helpMessage: string | null;
  codeframe: string | null;
}

export interface ParseEstreeOptions {
  filename?: string;
  language?: AstLanguage;
  sourceType?: AstSourceType;
  includeRanges?: boolean;
  checkSemantics?: boolean;
}

export interface ParsedEstree {
  program: ParsedProgram;
  comments: AstComment[];
  diagnostics: AstDiagnostic[];
}

export class EstreeParseError extends SyntaxError {
  public readonly diagnostics: AstDiagnostic[];

  constructor(filename: string, diagnostics: AstDiagnostic[]) {
    const first = diagnostics[0];
    super(
      first === undefined
        ? `Could not parse ${filename}`
        : `${filename}: ${first.message}`,
    );
    this.name = 'EstreeParseError';
    this.diagnostics = diagnostics;
  }
}

function asParsedProgram(program: BaseNode): ParsedProgram {
  if (
    program.type !== 'Program' ||
    !Array.isArray((program as unknown as { body?: unknown }).body)
  ) {
    throw new TypeError('ESTree parser returned a non-Program root');
  }
  return program as ParsedProgram;
}

function sourcePosition(
  offset: number,
  lineStarts: readonly number[],
): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle]! <= offset) low = middle;
    else high = middle;
  }
  return { line: low + 1, column: offset - lineStarts[low]! };
}

function sourceLocations(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function locationFor(
  start: number,
  end: number,
  lineStarts: readonly number[],
  filename: string,
): SourceLocation {
  return {
    start: sourcePosition(start, lineStarts),
    end: sourcePosition(end, lineStarts),
    source: filename,
  };
}

function attachLocations(
  root: BaseNode,
  lineStarts: readonly number[],
  filename: string,
): void {
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      const items: readonly unknown[] = value;
      for (const item of items) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.type === 'string' &&
      typeof record.start === 'number' &&
      typeof record.end === 'number'
    ) {
      record.loc = locationFor(record.start, record.end, lineStarts, filename);
    }
    for (const [key, child] of Object.entries(record)) {
      if (key !== 'parent' && key !== 'loc') visit(child);
    }
  };
  visit(root);
}

/** Parse JavaScript, JSX, TypeScript, or TSX into ESTree/TS-ESTree. */
export function parseEstree(
  source: string,
  options: ParseEstreeOptions = {},
): ParsedEstree {
  const filename = options.filename ?? 'module.tsx';
  const result = parseSync(filename, source, {
    ...(options.language === undefined ? {} : { lang: options.language }),
    sourceType: options.sourceType ?? 'module',
    astType: 'ts',
    range: options.includeRanges ?? true,
    preserveParens: false,
    showSemanticErrors: options.checkSemantics ?? false,
  });
  const lineStarts = sourceLocations(source);
  const program = asParsedProgram(result.program);
  attachLocations(program, lineStarts, filename);

  return {
    program,
    comments: result.comments.map((comment) => ({
      ...comment,
      loc: locationFor(comment.start, comment.end, lineStarts, filename),
    })),
    diagnostics: result.errors,
  };
}

/** Parse source and throw one typed error when OXC reports a fatal diagnostic. */
export function parseEstreeOrThrow(
  source: string,
  options: ParseEstreeOptions = {},
): ParsedEstree {
  const parsed = parseEstree(source, options);
  const errors = parsed.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'Error',
  );
  if (errors.length > 0) {
    throw new EstreeParseError(options.filename ?? 'module.tsx', errors);
  }
  return parsed;
}
