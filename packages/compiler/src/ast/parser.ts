import {
  langFromPath,
  parse as parseYuku,
  sourceTypeFromPath,
} from 'yuku-parser';
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
  /** Optional static CSS extracted by a source-language frontend. */
  css?: string;
}

/** Parser adapter consumed by the backend-neutral ESTree compiler boundary. */
export interface EstreeFrontend {
  readonly name: string;
  parse(source: string, options?: ParseEstreeOptions): ParsedEstree;
}

/** Route known source extensions without silently assigning unknown files a parser. */
export function createExtensionEstreeFrontend(
  extensions: Readonly<Record<string, EstreeFrontend>>,
): EstreeFrontend {
  const routes = Object.entries(extensions)
    .map(([extension, frontend]) => [
      extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`,
      frontend,
    ] as const)
    .sort(([left], [right]) => right.length - left.length);
  return {
    name: `extensions(${routes.map(([extension]) => extension).join(',')})`,
    parse(source, options = {}) {
      const filename = options.filename ?? 'module.tsx';
      const cleanFilename = filename.split(/[?#]/, 1)[0]!.toLowerCase();
      const route = routes.find(([extension]) => cleanFilename.endsWith(extension));
      if (route === undefined) {
        throw new TypeError(
          `No ESTree frontend is registered for '${filename}'; pass a frontend explicitly`,
        );
      }
      return route[1].parse(source, options);
    },
  };
}

export class EstreeParseError extends SyntaxError {
  public readonly diagnostics: AstDiagnostic[];
  public readonly moduleId: string;
  public readonly loc?: { line: number; column: number };

  constructor(
    filename: string,
    diagnostics: AstDiagnostic[],
    source?: string,
  ) {
    const first = diagnostics[0];
    super(
      first === undefined
        ? `Could not parse ${filename}`
        : `${filename}: ${first.message}`,
    );
    this.name = 'EstreeParseError';
    this.moduleId = filename;
    this.diagnostics = diagnostics;
    const offset = first?.labels[0]?.start;
    if (source !== undefined && offset !== undefined) {
      this.loc = sourcePosition(offset, sourceLocations(source));
    }
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

function yukuSeverity(
  severity: 'error' | 'warning' | 'hint' | 'info',
): AstDiagnostic['severity'] {
  if (severity === 'error') return 'Error';
  if (severity === 'warning') return 'Warning';
  return 'Advice';
}

/** Parse through Yuku while returning the same compiler-owned ESTree result. */
export function parseYukuEstree(
  source: string,
  options: ParseEstreeOptions = {},
): ParsedEstree {
  const filename = options.filename ?? 'module.tsx';
  const cleanFilename = filename.split(/[?#]/, 1)[0]!;
  const result = parseYuku(source, {
    lang: options.language ?? langFromPath(cleanFilename),
    sourceType: options.sourceType === 'unambiguous'
      ? sourceTypeFromPath(cleanFilename)
      : options.sourceType ?? sourceTypeFromPath(cleanFilename),
    preserveParens: false,
    semanticErrors: options.checkSemantics ?? false,
  });
  const lineStarts = sourceLocations(source);
  const program = asParsedProgram(result.program as unknown as BaseNode);
  attachLocations(program, lineStarts, filename);
  return {
    program,
    comments: result.comments.map((comment) => ({
      type: comment.type,
      value: comment.value,
      start: comment.start,
      end: comment.end,
      loc: locationFor(comment.start, comment.end, lineStarts, filename),
    })),
    diagnostics: result.diagnostics.map((diagnostic) => ({
      severity: yukuSeverity(diagnostic.severity),
      message: diagnostic.message,
      labels: [
        {
          message: diagnostic.message,
          start: diagnostic.start,
          end: diagnostic.end,
        },
        ...diagnostic.labels.map((label) => ({
          message: label.message,
          start: label.start,
          end: label.end,
        })),
      ],
      helpMessage: diagnostic.help,
      codeframe: null,
    })),
  };
}

export const yukuEstreeFrontend: EstreeFrontend = {
  name: 'yuku',
  parse: parseYukuEstree,
};

/** Default standard-language parser retained under the original public name. */
export const parseEstree = parseYukuEstree;

/** Parse with an injected frontend adapter (Yuku, TSRX, or another parser). */
export function parseWithEstreeFrontend(
  frontend: EstreeFrontend,
  source: string,
  options: ParseEstreeOptions = {},
): ParsedEstree {
  return frontend.parse(source, options);
}

/** Parse through an injected frontend and reject its fatal diagnostics. */
export function parseWithEstreeFrontendOrThrow(
  frontend: EstreeFrontend,
  source: string,
  options: ParseEstreeOptions = {},
): ParsedEstree {
  const parsed = parseWithEstreeFrontend(frontend, source, options);
  const errors = parsed.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'Error',
  );
  if (errors.length > 0) {
    throw new EstreeParseError(
      options.filename ?? 'module.tsx',
      errors,
      source,
    );
  }
  return parsed;
}


/** Parse standard JavaScript/TypeScript source with Yuku and reject fatal diagnostics. */
export function parseEstreeOrThrow(
  source: string,
  options: ParseEstreeOptions = {},
): ParsedEstree {
  const parsed = parseYukuEstree(source, options);
  const errors = parsed.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'Error',
  );
  if (errors.length > 0) {
    throw new EstreeParseError(
      options.filename ?? 'module.tsx',
      errors,
      source,
    );
  }
  return parsed;
}
