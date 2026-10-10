/** Bun desktop build adapter. Application sources remain ordinary TSX entries. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { compileDesktopGraph } from '@memoized-dom/compiler/desktop';

export interface DesktopBuildOptions {
  /** Override the runtime module when embedding the builder against source. */
  runtimePath?: string;
}
export async function buildDesktopEntry(entry: string, options: DesktopBuildOptions = {}): Promise<string> {
  const runtime = options.runtimePath ?? import.meta.resolve('@memoized-dom/desktop');
  const core = import.meta.resolve('@memoized-dom/runtime/core');
  const sourceEntry = resolve(entry);
  const graph = compileDesktopGraph(readFileSync(sourceEntry, 'utf8'), {
    moduleId: sourceEntry,
    runtimePath: runtime,
    coreRuntimePath: core,
    readStylesheet: (specifier, importer = sourceEntry) =>
      readFileSync(resolve(dirname(importer), specifier), 'utf8'),
    readModule: (specifier, importer) => {
      if (!specifier.startsWith('.')) return undefined;
      const moduleId = Bun.resolveSync(specifier, dirname(importer));
      return { moduleId, source: readFileSync(moduleId, 'utf8') };
    },
  });
  const result = await Bun.build({
    entrypoints: [sourceEntry], target: 'bun',
    plugins: [{ name: 'memoized-dom-desktop', setup(build) {
      build.onResolve({ filter: /^@memoized-dom\/(runtime|desktop)$|^file:/ }, args => {
        if (args.path === core) return { path: core, external: true };
        if (args.path === '@memoized-dom/runtime' || args.path === '@memoized-dom/desktop' || args.path === runtime) return { path: runtime, external: true };
        return undefined;
      });
      build.onLoad({ filter: /\.(tsx?|tsrx|jsx?|mts)$/ }, args => {
        const compiled = graph.modules.get(args.path.replace(/\\/g, '/'));
        if (!compiled) return undefined;
        return { contents: compiled.code, loader: 'js' };
      });
    } }],
  });
  if (!result.success) throw new AggregateError(result.logs, 'Desktop entry compilation failed');
  if (result.outputs.length !== 1) throw new Error('Desktop entry must produce one executable module');
  return result.outputs[0]!.text();
}
