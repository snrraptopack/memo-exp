import { analyzeTsrx, parseModule } from '@tsrx/core';
import type { BaseNode, SourceLocation } from '../types';
import {
  createExtensionEstreeFrontend,
  EstreeParseError,
  yukuEstreeFrontend,
  type AstComment,
  type AstDiagnostic,
  type EstreeFrontend,
  type ParsedEstree,
  type ParsedProgram,
  type ParseEstreeOptions,
} from '../parser';
import { lowerTsrxProgram, TsrxLoweringError } from './lower';
import { prepareTsrxStyles } from './style';

interface TsrxParserError extends Error {
  pos?: number;
  end?: number;
  raisedAt?: number;
}

interface TsrxComment {
  type: 'Line' | 'Block';
  value: string;
  start: number;
  end: number;
  loc: SourceLocation;
}

function diagnostic(error: TsrxParserError): AstDiagnostic {
  const start = error.pos ?? 0;
  const end = error.end ?? error.raisedAt ?? start + 1;
  return {
    severity: 'Error',
    message: error.message,
    labels: [{ message: error.message, start, end }],
    helpMessage: null,
    codeframe: null,
  };
}

function loweringDiagnostic(error: TsrxLoweringError): AstDiagnostic {
  const record = error.node as unknown as Record<string, unknown>;
  const start = typeof record.start === 'number' ? record.start : 0;
  const end = typeof record.end === 'number' ? record.end : start + 1;
  return {
    severity: 'Error',
    message: error.message,
    labels: [{ message: error.message, start, end }],
    helpMessage: null,
    codeframe: null,
  };
}

/** Parse TSRX and directly lower its supported extensions to standard ESTree/JSX. */
export function parseTsrxEstree(
  source: string,
  options: ParseEstreeOptions = {},
): ParsedEstree {
  const filename = options.filename ?? 'module.tsrx';
  const errors: TsrxParserError[] = [];
  const comments: TsrxComment[] = [];
  let parsed: BaseNode;
  try {
    parsed = parseModule(source, filename, {
      collect: true,
      preserveParens: false,
      errors,
      comments,
    }) as unknown as BaseNode;
  } catch (error) {
    const parseError = error instanceof Error ? error as TsrxParserError : new Error(String(error));
    throw new EstreeParseError(filename, [diagnostic(parseError)], source);
  }

  const diagnostics = errors.map(diagnostic);
  let program = parsed;
  let css = '';
  if (diagnostics.length === 0) {
    try {
      const semanticErrors: TsrxParserError[] = [];
      const analysis = analyzeTsrx(parsed, filename, {
        collect: true,
        errors: semanticErrors,
        comments,
      });
      diagnostics.push(...analysis.errors.map(diagnostic));
      program = analysis.ast as BaseNode;
      if (diagnostics.length === 0) {
        const styled = prepareTsrxStyles(program);
        program = lowerTsrxProgram(styled.program);
        css = styled.css;
      }
    } catch (error) {
      if (!(error instanceof TsrxLoweringError)) throw error;
      diagnostics.push(loweringDiagnostic(error));
    }
  }

  return {
    program: program as ParsedProgram,
    comments: comments.map((comment): AstComment => ({
      type: comment.type,
      value: comment.value,
      start: comment.start,
      end: comment.end,
      loc: { ...comment.loc, source: filename },
    })),
    diagnostics,
    css,
  };
}

/** Experimental direct TSRX-to-Memoized-ESTree frontend. */
export const experimentalTsrxEstreeFrontend: EstreeFrontend = {
  name: 'tsrx-experimental',
  parse: parseTsrxEstree,
};

/** Strict default router: each supported extension selects its parser explicitly. */
export const memoizedEstreeFrontend = createExtensionEstreeFrontend({
  '.js': yukuEstreeFrontend,
  '.jsx': yukuEstreeFrontend,
  '.ts': yukuEstreeFrontend,
  '.tsx': yukuEstreeFrontend,
  '.d.ts': yukuEstreeFrontend,
  '.tsrx': experimentalTsrxEstreeFrontend,
});
