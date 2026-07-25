/**
 * @file solid-plugin.ts
 * Applies Solid's production DOM preset before esbuild bundles the TSX.
 */
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { transformAsync } from '@babel/core';
import solidPreset from 'babel-preset-solid';
import { transform, type Plugin } from 'esbuild';

export const solidPlugin: Plugin = {
  name: 'native-solid',
  setup(build) {
    build.onLoad({ filter: /adapters[\\/]solid\.tsx$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      const stripped = await transform(source, {
        loader: 'tsx',
        jsx: 'preserve',
        target: 'esnext',
      });
      const output = await transformAsync(stripped.code, {
        filename: path,
        babelrc: false,
        configFile: false,
        parserOpts: {
          sourceType: 'module',
          plugins: ['jsx'],
        },
        presets: [[solidPreset, { generate: 'dom', hydratable: false }]],
      });
      return {
        contents: output?.code ?? '',
        loader: 'js',
        resolveDir: dirname(path),
      };
    });
  },
};
