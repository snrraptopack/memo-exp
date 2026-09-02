declare module '@tsrx/core' {
  export interface ParseModuleOptions {
    collect?: boolean;
    loose?: boolean;
    preserveParens?: boolean;
    keywordTokens?: boolean;
    errors?: Error[];
    comments?: unknown[];
  }

  export interface TsrxCoreError extends Error {
    pos?: number;
    end?: number;
    raisedAt?: number;
  }

  export interface AnalyzeTsrxOptions {
    collect?: boolean;
    loose?: boolean;
    typeOnly?: boolean;
    to_ts?: boolean;
    errors?: TsrxCoreError[];
    comments?: unknown[];
  }

  export interface AnalyzeTsrxResult {
    ast: unknown;
    errors: TsrxCoreError[];
    comments: unknown[];
  }

  export function parseModule(
    source: string,
    filename: string,
    options?: ParseModuleOptions,
  ): unknown;

  export function analyzeTsrx(
    ast: unknown,
    filename?: string | null,
    options?: AnalyzeTsrxOptions,
  ): AnalyzeTsrxResult;

  export function prepareStylesheetForRender(stylesheet: object): object;
  export function annotateWithHash(
    node: object,
    hash: string,
    jsxClassAttributeName?: 'class' | 'className',
    preserveStyleElements?: boolean,
  ): object | null;
  export function renderStylesheets(
    stylesheets: readonly object[],
    minify?: boolean,
  ): string;
}
