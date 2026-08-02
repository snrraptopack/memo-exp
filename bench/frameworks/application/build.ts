import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type BuildOptions, type Plugin } from 'esbuild';
import { solidPlugin } from '../build/solid-plugin';
import { sveltePlugin } from '../build/svelte-plugin';
import { vuePlugin } from '../build/vue-plugin';
import { compileMemoizedApplication } from './build/memoized';
import { writeApplicationHtml } from './build/html';
import { writeApplicationUi } from './build/ui-html';

const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(root, 'dist');
const dependencyRoot = resolve(root, '../node_modules');

interface BundleSpec {
  applicationPage?: boolean;
  entry: string;
  id: string;
  jsxImportSource?: string;
  packageName?: string;
  plugins?: Plugin[];
}

function packageVersion(packageName: string): string {
  const manifest = JSON.parse(
    readFileSync(
      resolve(dependencyRoot, `${packageName}/package.json`),
      'utf8',
    ),
  ) as { version: string };
  return manifest.version;
}

async function bundle(spec: BundleSpec): Promise<void> {
  const options: BuildOptions = {
    bundle: true,
    define: {
      __FRAMEWORK_VERSION__: JSON.stringify(
        spec.packageName
          ? packageVersion(spec.packageName)
          : 'browser',
      ),
      'process.env.NODE_ENV': '"production"',
    },
    entryPoints: [resolve(root, spec.entry)],
    format: 'iife',
    legalComments: 'none',
    minify: true,
    nodePaths: [dependencyRoot],
    outfile: resolve(output, `${spec.id}.js`),
    platform: 'browser',
    plugins: spec.plugins,
    target: 'es2022',
  };
  if (spec.jsxImportSource) {
    options.jsx = 'automatic';
    options.jsxImportSource = spec.jsxImportSource;
  }
  await build(options);
  if (spec.applicationPage !== false) {
    writeApplicationHtml(root, spec.id);
  }
}

rmSync(output, { force: true, recursive: true });
mkdirSync(output, { recursive: true });

const memoizedEntry = compileMemoizedApplication(root);

await Promise.all([
  bundle({ entry: 'adapters/vanilla.ts', id: 'vanilla' }),
  bundle({
    entry: 'adapters/react.tsx',
    id: 'react',
    jsxImportSource: 'react',
    packageName: 'react',
  }),
  bundle({
    entry: 'adapters/preact.tsx',
    id: 'preact',
    jsxImportSource: 'preact',
    packageName: 'preact',
  }),
  bundle({
    entry: 'adapters/solid.tsx',
    id: 'solid',
    packageName: 'solid-js',
    plugins: [solidPlugin],
  }),
  bundle({
    entry: 'entries/svelte.ts',
    id: 'svelte',
    packageName: 'svelte',
    plugins: [sveltePlugin],
  }),
  bundle({
    entry: 'entries/vue.ts',
    id: 'vue',
    packageName: 'vue',
    plugins: [vuePlugin],
  }),
  bundle({ entry: memoizedEntry, id: 'memoized-dom' }),
  bundle({
    applicationPage: false,
    entry: 'ui/main.ts',
    id: 'dashboard',
  }),
]);

writeApplicationUi(root);
console.log('Built isolated production application benchmark pages.');
