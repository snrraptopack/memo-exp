/** Bun desktop build adapter. Application sources remain ordinary TSX entries. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { compileDesktop } from '@memoized-dom/compiler/desktop';

export interface DesktopBuildOptions {
  /** Override the runtime module when embedding the builder against source. */
  runtimePath?: string;
}
export async function buildDesktopEntry(entry: string, options: DesktopBuildOptions = {}): Promise<string> {
  const runtime = options.runtimePath ?? import.meta.resolve('@memoized-dom/desktop');
  const result = await Bun.build({
    entrypoints: [resolve(entry)], target: 'bun',
    plugins: [{ name: 'memoized-dom-desktop', setup(build) {
      build.onResolve({ filter: /^@memoized-dom\/(runtime|desktop)$|^file:/ }, args => {
        if (args.path === '@memoized-dom/runtime' || args.path === '@memoized-dom/desktop' || args.path === runtime) return { path: runtime, external: true };
        return undefined;
      });
      build.onLoad({ filter: /\.(tsx|tsrx)$/ }, args => ({
        contents: compileDesktop(readFileSync(args.path, 'utf8'), {
          moduleId: args.path, runtimePath: runtime,
          readStylesheet: (specifier: string) => readFileSync(resolve(dirname(args.path), specifier), 'utf8'),
        }).code,
        loader: 'js',
      }));
    } }],
  });
  if (!result.success) throw new AggregateError(result.logs, 'Desktop entry compilation failed');
  if (result.outputs.length !== 1) throw new Error('Desktop entry must produce one executable module');
  return result.outputs[0]!.text();
}
