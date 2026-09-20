/**
 * Public configuration for the Vite connected-graph adapter.
 */
import type { CompileModulesOptions } from '@memoized-dom/compiler';

export interface MemoizedDomViteOptions
  extends Omit<CompileModulesOptions, 'aliases' | 'resolveImport' | 'hot'> {
  /** Browser bootstrap and connected compiler-graph entry. */
  clientEntry: string;
  /** Server composition root. Omit for browser-only applications. */
  serverEntry?: string;
  /**
   * Additional source paths allowed outside the Vite project root.
   */
  include?: RegExp | readonly RegExp[];
  /**
   * Source paths excluded from connected-graph compilation.
   */
  exclude?: RegExp | readonly RegExp[];
  /**
   * Server-only convention root. Its config/index.ts registers application
   * server types and its functions directory contains server functions.
   */
  server?: string;
}

export interface ResolvedAdapterOptions
  extends Omit<MemoizedDomViteOptions, 'clientEntry'> {
  entries: readonly string[];
}

export function resolveAdapterOptions(
  options: MemoizedDomViteOptions,
): ResolvedAdapterOptions {
  if (options.clientEntry.trim() === '') {
    throw new Error('memoized-dom: clientEntry must not be empty');
  }
  return { ...options, entries: [options.clientEntry] };
}
