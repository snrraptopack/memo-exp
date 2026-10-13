import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { executionCommand, resolveExecutionBackend, type RuntimeSelection } from './execution';

/** Private compiler/adapter import; applications still author ordinary mount(). */
export const HOST_ADAPTER_IMPORT = '@memoized-dom/desktop/internal-host';

export interface ExecutionBundleOptions {
  /** Already emitted application JS; TSX semantic compilation belongs to M3. */
  readonly entry: string;
  readonly outfile: string;
  readonly runtime?: RuntimeSelection;
  readonly cwd?: string;
}

/**
 * Bun is the build tool, independent of the engine that runs the result. Resolve
 * one selected host module while bundling; unused backends are not imported.
 */
export async function bundleExecutionEntry(options: ExecutionBundleOptions) {
  const backend = resolveExecutionBackend(options.runtime);
  const cwd = options.cwd ?? process.cwd();
  const adapter = backend.hostAdapter.startsWith('file:')
    ? fileURLToPath(backend.hostAdapter)
    : resolve(cwd, backend.hostAdapter);
  const outfile = resolve(cwd, options.outfile);
  const build = await Bun.build({
    entrypoints: [resolve(cwd, options.entry)],
    format: backend.moduleFormat,
    target: backend.bundleTarget ?? 'browser',
    external: [...(backend.external ?? [])],
    sourcemap: 'none',
    plugins: [{
      name: 'desktop-execution-host',
      setup(builder) {
        builder.onResolve({ filter: /^@memoized-dom\/desktop\/internal-host$/ }, () => ({
          path: adapter,
        }));
        builder.onResolve({ filter: /^@memoized-dom\/desktop\/internal-runtime$/ }, () => ({
          path: fileURLToPath(new URL('../runtime/view.ts', import.meta.url)),
        }));
      },
    }],
  });
  if (!build.success) {
    throw new AggregateError(build.logs, 'Desktop execution bundle failed for ' + backend.name);
  }
  // This contract intentionally has one application artifact. Assets and code
  // splitting get their own manifest when the desktop compiler integrates them.
  if (build.outputs.length !== 1) {
    throw new Error('Desktop execution entry unexpectedly produced multiple artifacts');
  }
  await mkdir(dirname(outfile), { recursive: true });
  await Bun.write(outfile, build.outputs[0]!);
  return {
    backend,
    entry: outfile,
    command: executionCommand(outfile, backend),
  };
}
