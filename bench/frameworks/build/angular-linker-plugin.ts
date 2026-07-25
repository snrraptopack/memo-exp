/**
 * @file angular-linker-plugin.ts
 * Links Angular's partially compiled production libraries during esbuild bundling.
 */
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { transformAsync } from '@babel/core';
import angularLinker from '@angular/compiler-cli/linker/babel';
import type { Plugin } from 'esbuild';

export const angularLinkerPlugin: Plugin = {
  name: 'angular-linker',
  setup(build) {
    build.onLoad(
      { filter: /node_modules[\\/]@angular[\\/].*\.m?js$/ },
      async ({ path }) => {
        const source = await readFile(path, 'utf8');
        if (!source.includes('ɵɵngDeclare')) {
          return { contents: source, loader: 'js' };
        }

        const result = await transformAsync(source, {
          babelrc: false,
          compact: false,
          configFile: false,
          filename: path,
          plugins: [[angularLinker, { linkerJitMode: false }]],
          sourceMaps: false,
        });
        if (!result?.code) {
          throw new Error(`Angular linker produced no output for ${path}`);
        }
        return {
          contents: result.code,
          loader: 'js',
          resolveDir: dirname(path),
        };
      },
    );
  },
};
