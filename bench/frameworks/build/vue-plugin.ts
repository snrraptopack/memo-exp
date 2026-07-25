/**
 * @file vue-plugin.ts
 * Compiles Vue SFCs with the version-matched production SFC compiler.
 */
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import type { Plugin } from 'esbuild';

export const vuePlugin: Plugin = {
  name: 'native-vue-sfc',
  setup(build) {
    build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      const { descriptor, errors } = parse(source, { filename: path });
      if (errors.length) throw errors[0];

      const id = `bench-${Buffer.from(path).toString('hex').slice(-12)}`;
      const script = compileScript(descriptor, {
        id,
        genDefaultAs: '__sfc__',
      });
      const template = compileTemplate({
        id,
        filename: path,
        source: descriptor.template?.content ?? '',
        compilerOptions: { bindingMetadata: script.bindings },
      });
      if (template.errors.length) throw template.errors[0];

      const templateCode = template.code.replace(
        'export function render',
        'function render',
      );
      return {
        contents: `${script.content}\n${templateCode}\n__sfc__.render = render;\nexport default __sfc__;`,
        loader: 'ts',
        resolveDir: dirname(path),
      };
    });
  },
};
