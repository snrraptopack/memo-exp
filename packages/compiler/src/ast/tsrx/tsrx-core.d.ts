declare module '@tsrx/core' {
  export interface ParseModuleOptions {
    collect?: boolean;
    loose?: boolean;
    preserveParens?: boolean;
    keywordTokens?: boolean;
    errors?: Error[];
    comments?: unknown[];
  }

  export function parseModule(
    source: string,
    filename: string,
    options?: ParseModuleOptions,
  ): unknown;

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
