/**
 * Public configuration for the Vite connected-graph adapter.
 */
import type { CompileModulesOptions } from '@memoized-dom/compiler';

export interface MemoizedDomViteOptions
  extends Omit<CompileModulesOptions, 'aliases' | 'resolveImport' | 'hot'> {
  /** Browser bootstrap and connected compiler-graph entry. */
  clientEntry: string;
  /** Selects emission only; application authoring and CSS processing stay in Vite. */
  target?: 'web' | 'desktop';
  /** Server composition root. Omit for browser-only applications. */
  serverEntry?: string;
  /** Production host target. Bun/Node dev uses the launching runtime; Cloudflare dev uses workerd. */
  runtime?: 'bun' | 'node' | 'cloudflare';
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
  if (options.target === 'desktop' && options.serverEntry !== undefined) {
    throw new Error('memoized-dom: the desktop build does not implement server delivery');
  }
  return { ...options, entries: [options.clientEntry] };
}
