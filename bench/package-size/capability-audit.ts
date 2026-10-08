/** Public-package reachability probes; these measure selected APIs, not application delivery. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const entries = {
  runtime: { '.': 'index.ts', '/client': 'index.ts', '/server': 'server.ts', '/hydrate': 'hydrate.ts', '/hydrate-program': 'hydrate-program.ts' },
  data: { '.': 'index.ts', '/internal': 'internal.ts' },
  router: { '.': 'index.ts', '/internal': 'internal.ts' },
  utils: { '.': 'index.ts' },
  adapters: { '.': 'index.ts', '/bun': 'bun.ts', '/node': 'node.ts' },
  server: { '.': 'index.ts', '/router': 'http-router.ts' },
};

export const capabilityProbes = {
  optimistic: { code: `export {optimistic} from '@memoized-dom/utils';`, platform: 'browser' },
  'adapter-html': { code: `export {htmlResponse} from '@memoized-dom/adapters';`, platform: 'browser' },
  'adapter-stream': { code: `export {createDocumentStream} from '@memoized-dom/adapters';`, platform: 'browser' },
  'adapter-bun': { code: `export {createBunFetch} from '@memoized-dom/adapters/bun';`, platform: 'node' },
  'adapter-node-request': { code: `export {toWebRequest} from '@memoized-dom/adapters/node';`, platform: 'node' },
  'server-json': { code: `export {json} from '@memoized-dom/server';`, platform: 'node' },
  'server-string': { code: `export {renderToString} from '@memoized-dom/server';`, platform: 'node' },
} as const;

export async function measureCapability(name: keyof typeof capabilityProbes, graph: 'source' | 'package') {
  const probe = capabilityProbes[name];
  const alias: Record<string, string> = {};
  if (graph === 'source') for (const [pkg, paths] of Object.entries(entries)) {
    for (const [subpath, entry] of Object.entries(paths)) {
      alias[`@memoized-dom/${pkg}${subpath === '.' ? '' : subpath}`] = resolve(root,
        `packages/${pkg}/src/${pkg === 'runtime' && subpath === '.' && probe.platform === 'node' ? 'server.ts' : entry}`);
    }
  }
  const result = await build({
    stdin: { contents: probe.code, resolveDir: root }, alias,
    platform: probe.platform, bundle: true, write: false, metafile: true,
    format: 'iife', globalName: 'Capability', minify: true, outfile: 'probe.js',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const code = result.outputFiles[0]!.text;
  const inputs = Object.entries(result.metafile!.outputs['probe.js']!.inputs)
    .filter(([, input]) => input.bytesInOutput > 0)
    .map(([path, input]) => ({ path: path.replaceAll('\\', '/'), bytes: input.bytesInOutput }));
  return { name, graph, platform: probe.platform, raw: Buffer.byteLength(code), gzip: gzipSync(code).length, inputs, code };
}

if (import.meta.main) {
  const directory = resolve(import.meta.dirname, 'dist/capabilities');
  mkdirSync(directory, { recursive: true });
  const rows = [];
  for (const name of Object.keys(capabilityProbes) as Array<keyof typeof capabilityProbes>) {
    for (const graph of ['source', 'package'] as const) {
      const row = await measureCapability(name, graph);
      rows.push(row);
      console.log(`${name}/${graph}: ${row.raw} raw / ${row.gzip} gzip B`);
    }
  }
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  writeFileSync(resolve(directory, 'results.json'), JSON.stringify({ revision, measuredAt: new Date().toISOString(), rows }, null, 2));
  writeFileSync(resolve(directory, 'results.md'), [
    '# Public capability audit', '', `HEAD: ${revision}. Working changes may be included.`, '',
    'Selected public APIs, bundled independently. Server probes measure server code; they are not browser cost. Whole-bundle gzip is not additive.', '',
    '| Probe | Graph | Platform | Raw B | Gzip B |', '|---|---|---|---:|---:|',
    ...rows.map(row => `| ${row.name} | ${row.graph} | ${row.platform} | ${row.raw} | ${row.gzip} |`), '',
  ].join('\n'));
}
