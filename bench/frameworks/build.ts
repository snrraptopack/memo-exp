/**
 * @file build.ts
 * Produces isolated production bundles from every framework's native format.
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type BuildOptions, type Plugin } from 'esbuild';
import { compileAngular } from './build/angular';
import { angularLinkerPlugin } from './build/angular-linker-plugin';
import { writeAdapterHtml } from './build/html';
import { compileMemoized } from './build/memoized';
import { solidPlugin } from './build/solid-plugin';
import { sveltePlugin } from './build/svelte-plugin';
import { vuePlugin } from './build/vue-plugin';

const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(root, 'dist');

interface BundleSpec {
  id: string;
  entry: string;
  packageName?: string;
  jsxImportSource?: string;
  plugins?: Plugin[];
}

function packageVersion(packageName: string): string {
  const manifest = JSON.parse(
    readFileSync(resolve(root, `node_modules/${packageName}/package.json`), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

async function bundle(spec: BundleSpec): Promise<void> {
  const options: BuildOptions = {
    entryPoints: [resolve(root, spec.entry)],
    outfile: resolve(output, `${spec.id}.js`),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    plugins: spec.plugins,
    define: {
      __FRAMEWORK_VERSION__: JSON.stringify(
        spec.packageName ? packageVersion(spec.packageName) : 'browser',
      ),
      'process.env.NODE_ENV': '"production"',
    },
  };
  if (spec.jsxImportSource) {
    options.jsx = 'automatic';
    options.jsxImportSource = spec.jsxImportSource;
  }
  await build(options);
  writeAdapterHtml(root, spec.id);
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const angularEntry = compileAngular(root);
const memoizedEntry = compileMemoized(root);

await Promise.all([
  bundle({ id: 'vanilla', entry: 'adapters/vanilla.ts' }),
  bundle({
    id: 'react',
    entry: 'adapters/react.tsx',
    packageName: 'react',
    jsxImportSource: 'react',
  }),
  bundle({
    id: 'vue',
    entry: 'entries/vue.ts',
    packageName: 'vue',
    plugins: [vuePlugin],
  }),
  bundle({
    id: 'angular',
    entry: angularEntry,
    packageName: '@angular/core',
    plugins: [angularLinkerPlugin],
  }),
  bundle({
    id: 'svelte',
    entry: 'entries/svelte.ts',
    packageName: 'svelte',
    plugins: [sveltePlugin],
  }),
  bundle({
    id: 'solid',
    entry: 'adapters/solid.tsx',
    packageName: 'solid-js',
    plugins: [solidPlugin],
  }),
  bundle({
    id: 'preact',
    entry: 'adapters/preact.tsx',
    packageName: 'preact',
    jsxImportSource: 'preact',
  }),
  bundle({ id: 'memoized-dom', entry: memoizedEntry }),
]);

console.log('Built isolated production framework benchmark pages.');
