/**
 * Public configuration for the Vite connected-graph adapter.
 */
import type { CompileModulesOptions } from '@memoized-dom/compiler';

export interface MemoizedDomViteOptions
  extends Omit<CompileModulesOptions, 'aliases' | 'resolveImport' | 'hot'> {
  /**
   * Authored graph roots, relative to Vite's configured project root.
   *
   * Every local TypeScript/JavaScript dependency reachable from these entries
   * is compiled as one linked graph.
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
