/** Vite owns source compilation and CSS; execution selection is independent. */
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { build, type Plugin, type InlineConfig } from 'vite';
import { memoizedDom } from '@memoized-dom/vite';
import { resolveExecutionBackend, type RuntimeSelection } from './execution';

export interface DesktopBuildOptions {
  readonly root: string;
  readonly entry: string;
  readonly outDir: string;
  readonly runtime?: RuntimeSelection;
  /** Ordinary Vite CSS/PostCSS/plugin configuration is honored. */
  readonly vite?: InlineConfig;
}

const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

/** Emit one engine identity once, before starting application watch builds. */
export async function buildDesktopEngine(options: DesktopBuildOptions) {
  const backend = resolveExecutionBackend(options.runtime);
  if (backend.moduleFormat !== 'esm') {
    throw new Error('The Vite desktop launcher currently requires an ESM execution backend');
  }
  const adapter = backend.hostAdapter.startsWith('file:')
    ? fileURLToPath(backend.hostAdapter)
    : resolve(options.root, backend.hostAdapter);
  const host: Plugin = {
    name: 'memoized-dom:execution-adapter',
    resolveId(id) {
      if (id === '@memoized-dom/desktop/internal-host') return adapter;
      return null;
    },
  };
  await build({
    configFile: false,
    root: options.root,
    plugins: [host],
    build: {
      outDir: options.outDir,
      emptyOutDir: false,
      target: 'esnext',
      lib: {
        entry: fileURLToPath(new URL('./engine.ts', import.meta.url)),
        formats: ['es'],
        fileName: () => 'engine.mjs',
      },
      rollupOptions: {
        external: id => builtins.has(id) || (backend.external ?? []).includes(id),
      },
    },
  });
  return backend;
}

/** Runner output is plain ESM, so Node never has to load our TypeScript files. */
export async function buildDesktopRunner(options: DesktopBuildOptions): Promise<void> {
  await build({
    configFile: false,
    root: options.root,
    build: {
      outDir: options.outDir,
      emptyOutDir: false,
      target: 'esnext',
      lib: {
        entry: fileURLToPath(new URL('./runner.ts', import.meta.url)),
        formats: ['es'],
        fileName: () => 'runner.mjs',
      },
      rollupOptions: { external: id => builtins.has(id) },
    },
  });
}

/** Reuse the connected Vite graph; only its emitter is selected as desktop. */
export function desktopApplicationConfig(options: DesktopBuildOptions, watch = false): InlineConfig {
  const engine = pathToFileURL(resolve(options.outDir, 'engine.mjs')).href;
  const nativeImports: Plugin = {
    name: 'memoized-dom:pinned-native-runtime',
    enforce: 'pre',
    resolveId(id) {
      if (
        id === '@memoized-dom/runtime' || id === '@memoized-dom/runtime/client' ||
        id === '@memoized-dom/runtime/core' || id === '@memoized-dom/desktop/internal-runtime'
      ) {
        return { id: engine, external: true };
      }
      return null;
    },
  };
  const user = options.vite ?? {};
  const assets: Plugin = {
    name: 'memoized-dom:native-css-assets',
    enforce: 'post',
    async writeBundle(_output, bundle) {
      const manifestFile = resolve(options.outDir, 'desktop.json');
      const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
      manifest.stylesheets = Object.values(bundle)
        .filter(item => item.type === 'asset' && item.fileName.endsWith('.css'))
        .map(item => item.fileName);
      manifest.entry = Object.values(bundle)
        .find(item => item.type === 'chunk' && item.isEntry)?.fileName;
      await writeFile(manifestFile, JSON.stringify(manifest));
    },
  };
  return {
    ...user,
    configFile: user.configFile ?? false,
    root: options.root,
    plugins: [
      nativeImports,
      memoizedDom({ clientEntry: options.entry, target: 'desktop' }),
      ...(user.plugins ?? []),
      assets,
    ],
    build: {
      ...user.build,
      outDir: options.outDir,
      emptyOutDir: false,
      target: 'esnext',
      watch: watch ? {} : null,
      cssCodeSplit: false,
      lib: {
        entry: resolve(options.root, options.entry),
        formats: ['es'],
        fileName: () => 'application.mjs',
        cssFileName: 'application',
      },
      rollupOptions: {
        ...user.build?.rollupOptions,
        output: { entryFileNames: 'application-[hash].mjs' },
      },
    },
  };
}
