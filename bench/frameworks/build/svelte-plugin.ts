/**
 * @file svelte-plugin.ts
 * Compiles native Svelte files for the production client runtime.
 */
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { compile } from 'svelte/compiler';
import type { Plugin } from 'esbuild';

export const sveltePlugin: Plugin = {
  name: 'native-svelte',
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      const output = compile(source, {
        filename: path,
        generate: 'client',
        dev: false,
        css: 'injected',
        runes: true,
      });
      return {
        contents: output.js.code,
        loader: 'js',
        resolveDir: dirname(path),
      };
    });
  },
};
