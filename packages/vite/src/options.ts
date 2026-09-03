/**
 * Public configuration for the Vite connected-graph adapter.
 */
import type { CompileModulesOptions } from '@memoized-dom/compiler';

export interface MemoizedDomServerFunctionsOptions {
  /** Vite-root-relative directory containing named HTTP functions. */
  readonly directory?: string;
}

export interface MemoizedDomViteOptions
  extends Omit<CompileModulesOptions, 'aliases' | 'resolveImport' | 'hot'> {
  /**
   * Ordinary TypeScript browser entries, relative to Vite's project root.
   * Each connected graph must contain one top-level mount(target, Component)
   * call; local dependencies are compiled as one linked application graph.
   */
  entries: string | readonly string[];
  /**
   * Additional source paths allowed outside the Vite project root.
   */
  include?: RegExp | readonly RegExp[];
  /**
   * Source paths excluded from connected-graph compilation.
   */
  exclude?: RegExp | readonly RegExp[];
  /**
   * Named HTTP function discovery. Enabled at server/functions by default;
   * use false to disable it or provide a different directory.
   */
  serverFunctions?: false | string | MemoizedDomServerFunctionsOptions;
}

export interface ResolvedAdapterOptions
  extends Omit<MemoizedDomViteOptions, 'entries'> {
  entries: readonly string[];
}

export function resolveAdapterOptions(
  options: MemoizedDomViteOptions,
): ResolvedAdapterOptions {
  const entries =
    typeof options.entries === 'string' ? [options.entries] : options.entries;
  if (entries.length === 0) {
    throw new Error('memoized-dom: Vite adapter requires at least one entry');
  }
  return { ...options, entries: [...entries] };
}
