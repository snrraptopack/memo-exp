/** Attribute minified browser bytes to stable compiler-generated source graphs. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { posix, resolve } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { build } from 'esbuild';
import { compileModulesDetailed } from '@memoized-dom/compiler';
import { sizeFixtures } from './fixtures';
import { hydrationBootstrap, hydrationVirtualId } from '../../packages/vite/src/hydration';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--verify' && arg !== '--hydrate' && arg !== '--hydrate-program' && !/^--baseline-hydration=(general|program)$/.test(arg) && !arg.startsWith('--before-ref=') && !arg.startsWith('--fixture='))) throw new Error('Use --verify, --hydrate, --hydrate-program, --baseline-hydration=general|program, --before-ref=<commit> or --fixture=<name>');
const programHydration = args.includes('--hydrate-program');
const baselineProgramHydration=!args.includes('--baseline-hydration=general');
const hydration = args.includes('--hydrate') || programHydration;

const root = resolve(import.meta.dirname, '../..');
const directory = resolve(import.meta.dirname, programHydration ? 'dist/audit-program-hydration' : hydration ? 'dist/audit-hydration' : 'dist/audit');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
mkdirSync(directory, { recursive: true });
const reference = args.find(arg => arg.startsWith('--before-ref='))?.slice(13);
let baseline: string | undefined;
let baselineRoot: string | undefined;
if (reference !== undefined) {
  baseline = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${reference}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40,64}$/.test(baseline)) throw new Error('Invalid runtime baseline');
  baselineRoot = resolve(directory, `baseline-${baseline.slice(0, 8)}`);
  mkdirSync(baselineRoot, { recursive: true });
  const archive = resolve(baselineRoot, 'runtime.tar');
  execFileSync('git', ['archive', `--output=${archive}`, baseline,
    'packages/runtime/src', 'packages/runtime/package.json',
    'packages/data/src', 'packages/data/package.json',
    'packages/router/src', 'packages/router/package.json'], { cwd: root });
  execFileSync('tar', ['-xf', archive, '-C', baselineRoot]);
}
const rows: Array<{ fixture: string; graph: string; raw: number; gzip: number; brotli: number;
  inputs: Array<{ path: string; bytes: number }> }> = [];
const selected = new Set(args.filter(arg => arg.startsWith('--fixture=')).map(arg => arg.slice(10)));
for (const name of selected) if (!Object.hasOwn(sizeFixtures, name)) throw new Error(`Unknown fixture ${name}`);
for (const [fixture, sources] of Object.entries(sizeFixtures)) {
  if (selected.size && !selected.has(fixture)) continue;
  const compilation = compileModulesDetailed({ ...sources,
    './main.ts': `${hydration ? `import '${programHydration ? hydrationVirtualId : '@memoized-dom/runtime/hydrate'}';` : ''}import {mount} from '@memoized-dom/runtime';import {App} from './App';mount('root',App);`,
  });
  const compiled = compilation.output;
  if (fixture === 'mixed-lists' && (!compiled['./App.tsx']?.includes('createListRegion') ||
      !compiled['./App.tsx']?.includes('createPositionalListRegion'))) throw new Error('The mixed fixture must exercise both list capabilities');
  if (fixture === 'request-markup' && !compiled['./App.tsx']?.includes('materializeMarkup')) {
    throw new Error('The markup fixture must exercise template materialization');
  }
  const modules = new Map(Object.entries(compiled).map(([id, source]) => [posix.resolve('/', id), source]));
  for (const graph of ['package', 'source', ...(baselineRoot ? ['source-before'] : [])]) {
    const graphRoot = graph === 'source-before' ? baselineRoot! : root;
    const result = await build({ stdin: { contents: "import '@size-fixture/main.ts';", resolveDir: root },
      bundle: true, write: false, format: 'esm', platform: 'browser', minify: true, metafile: true,
      define: { 'process.env.NODE_ENV': '"production"' }, outfile: 'browser.js',
      plugins: [{ name: 'size-fixtures', setup(builder) {
        if (programHydration) {
          builder.onResolve({ filter: /^virtual:memoized-dom\/hydration$/ }, () => ({ path: '/hydration.ts', namespace: 'hydration-boot' }));
          builder.onLoad({ filter: /.*/, namespace: 'hydration-boot' }, () => ({
            contents: graph === 'source-before' && !baselineProgramHydration ? "import '@memoized-dom/runtime/hydrate';" : hydrationBootstrap(compilation.hydrationCapabilities),
            loader: 'ts', resolveDir: root,
          }));
        }
        builder.onResolve({ filter: /^@size-fixture\// }, args => ({
          path: `/${args.path.slice('@size-fixture/'.length)}`, namespace: 'fixture',
        }));
        builder.onResolve({ filter: /^\./, namespace: 'fixture' }, args => {
          const path = posix.resolve(posix.dirname(args.importer), args.path);
          const id = [path, `${path}.ts`, `${path}.tsx`].find(id => modules.has(id));
          if (!id) throw new Error(`Missing fixture module ${path}`);
          return { path: id, namespace: 'fixture' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
          contents: modules.get(args.path)!, loader: 'ts', resolveDir: root,
        }));
        if (graph !== 'package') builder.onResolve({ filter: /^@memoized-dom\/runtime(?:\/client|\/hydrate|\/hydrate-program)?$/ }, args => ({
          path: resolve(graphRoot, args.path.endsWith('/hydrate-program') ? 'packages/runtime/src/hydrate-program.ts' : args.path.endsWith('/hydrate') ? 'packages/runtime/src/hydrate.ts' : 'packages/runtime/src/index.ts'),
        }));
        if (graph !== 'package') builder.onResolve({ filter: /^@memoized-dom\/data(?:\/internal)?$/ }, args => ({
          path: resolve(graphRoot, args.path.endsWith('/internal') ? 'packages/data/src/internal.ts' : 'packages/data/src/index.ts'),
        }));
        if (graph !== 'package') builder.onResolve({ filter: /^@memoized-dom\/router(?:\/internal)?$/ }, args => ({
          path: resolve(graphRoot, args.path.endsWith('/internal') ? 'packages/router/src/internal.ts' : 'packages/router/src/index.ts'),
        }));
      } }],
    });
    const output = result.outputFiles[0]!;
    const inputs = Object.entries(Object.values(result.metafile!.outputs)[0]!.inputs)
      .map(([path, input]) => ({ path: path.replaceAll('\\', '/'), bytes: input.bytesInOutput }))
      .filter(input => input.bytes > 0).sort((a, b) => b.bytes - a.bytes);
    const row = { fixture, graph, raw: output.contents.byteLength, gzip: gzipSync(output.contents).byteLength,
      brotli: brotliCompressSync(output.contents).byteLength, inputs };
    if (programHydration && graph === 'source') {
      if (!compilation.hydrationCapabilities.list && inputs.some(input => input.path.endsWith('/hydration-list.ts'))) throw new Error('A program without lists retained list adoption');
      if (!compilation.hydrationCapabilities.markup && inputs.some(input => /\/(?:hydration-markup|markup-walk)\.ts$/.test(input.path))) throw new Error('A program without markup retained markup adoption');
    }
    if (fixture === 'request-routed-group' && graph !== 'source-before' &&
      inputs.some(input => /router\/(?:src|dist)\/preparation\.(?:ts|js)$/.test(input.path))) {
      throw new Error('Ordinary routing must not retain route preparation execution');
    }
    if (fixture === 'route-helper' && graph !== 'source-before' && /new RegExp\(/.test(output.text)) {
      throw new Error('Path interpolation must not retain pattern matching expressions');
    }
    if (['request-group','request-routed-group','request-data'].includes(fixture) && graph !== 'source-before' &&
      inputs.some(input => input.path.endsWith('/data/src/resource-writes.ts'))) {
      throw new Error('Read-only fetched pages must not retain the optional mutation implementation');
    }
    rows.push(row);
    writeFileSync(resolve(directory, `${fixture}-${graph}.js`), output.contents);
    writeFileSync(resolve(directory, `${fixture}-${graph}.meta.json`), JSON.stringify(result.metafile, null, 2));
    console.log(`${fixture.padEnd(16)} ${graph.padEnd(7)} ${row.raw} B raw / ${row.gzip} B gzip / ${row.brotli} B br`);
  }
}
const lines = ['# Browser bundle audit', '',
  `HEAD: ${revision}. Working tree includes changes: ${status !== ''}.`, '',
  `Runtime/data/router source baseline: ${baseline ?? 'not requested'}. All graphs use the current compiler and identical authored fixtures.`, '',
  'Stable authored fixtures compiled by the current compiler. Each graph includes mount and root metadata.', '',
  `Optional hydration included: ${hydration}; compiler-selected capabilities: ${programHydration}. Baseline hydration: ${programHydration?(baselineProgramHydration?'same program capabilities':'explicit general entry'):'same entry'}. Use --baseline-hydration=general only to compare older revisions without program hydration. Browser verification below checks client interactions; SSR adoption/recovery is covered by the hydration test suites.`, '',
  '`package` resolves published browser exports; `source` attributes the equivalent graph to runtime, data and router source modules. Each whole bundle is compressed once; input attribution is minified raw bytes, not additive gzip savings.', '',
  '| Fixture | Graph | Raw B | Gzip B | Brotli B |', '|---|---|---:|---:|---:|',
  ...rows.map(row => `| ${row.fixture} | ${row.graph} | ${row.raw} | ${row.gzip} | ${row.brotli} |`), ''];
if (process.argv.includes('--verify')) {
  const { default: puppeteer } = await import('puppeteer-core');
  const allowed = new Set(rows.flatMap(row => ['js', 'html'].map(extension => `${row.fixture}-${row.graph}.${extension}`)));
  const browser = await puppeteer.launch({ headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'win32'
      ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/chromium'),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const url = new URL(request.url);
    const name = url.searchParams.get('fixture') ?? url.pathname.slice(1);
    if (name === 'api/user') return Response.json({ name: 'Ada' });
    return allowed.has(name) ? new Response(Bun.file(resolve(directory, name))) : new Response('Not found', { status: 404 });
  } });
  try {
    for (const row of rows) {
      const html = resolve(directory, `${row.fixture}-${row.graph}.html`);
      writeFileSync(html, `<!doctype html><div id="root"></div><script type="module" src="./${row.fixture}-${row.graph}.js"></script>`);
      const page = await browser.newPage();
      const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
      try {
        await page.goto(`http://127.0.0.1:${server.port}/?fixture=${row.fixture}-${row.graph}.html`);
        await page.waitForSelector('#root>main', { timeout: 5000 });
        if (row.fixture.startsWith('request-') || row.fixture === 'promise-data') await page.waitForFunction(() => document.querySelector('#root main p')?.textContent === 'Ada');
        if (row.fixture === 'request-routed-group') {
          await page.click('.about'); await page.waitForSelector('h2');
          await page.click('.home'); await page.waitForFunction(() => document.querySelector('main p')?.textContent === 'Ada');
        }
        await page.evaluate(async fixture => {
          const main = document.querySelector('#root>main')!;
          const button = main.querySelector('button')!;
          const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
          const check = (condition: boolean) => { if (!condition) throw new Error(`Failed ${fixture} interaction`); };
          if (fixture === 'static') { check(main.textContent === 'Static shellReady.'); return; }
          if (fixture === 'route-helper') {
            check(main.querySelector('a')?.getAttribute('href') === '/person/1');
            button.click(); await settle();
            check(main.querySelector('a')?.getAttribute('href') === '/person/2'); return;
          }
          if (fixture.startsWith('request-') || fixture === 'promise-data') {
            check(main.querySelector('p')?.textContent === 'Ada');
            if (fixture === 'request-markup') {
              const cards = [...main.querySelectorAll('article')];
              check(cards.length === 16 && cards.every((card,index) =>
                card.getAttribute('data-card') === String(index) &&
                card.textContent === `Card ${index}Ready & waiting.`));
            }
            return;
          }
          if (fixture === 'input-list') {
            const input = main.querySelector('input')!;
            const originals = [...main.querySelectorAll('li')];
            for (const value of [' ', 'hello', 'hello']) {
              input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
              await settle(); button.click(); await settle();
            }
            const nodes = [...main.querySelectorAll('li')];
            check(nodes.length === 4 && nodes[0] === originals[0] && nodes[1] === originals[1]);
            check(nodes.map(node => node.textContent).join('|') === '0-helo|1-heoo3|2-hello|3-hello');
            check(input.value === ''); return;
          }
          if (fixture === 'owner-list') {
            const originals = [...main.querySelectorAll('li')]; button.click(); await settle();
            const nodes = [...main.querySelectorAll('li')];
            check(nodes.every((node, index) => node === originals[2 - index]));
            check(nodes.map(node => node.textContent).join('|') === 'three|two|one'); return;
          }
          if (fixture === 'mixed-lists') {
            const keyed=[...main.querySelectorAll('.keyed li')],positional=[...main.querySelectorAll('.positional li')];
            button.click();await settle();
            const nextKeyed=[...main.querySelectorAll('.keyed li')],nextPositional=[...main.querySelectorAll('.positional li')];
            check(nextKeyed[0]===keyed[1]&&nextKeyed[1]===keyed[0]);
            check(nextPositional[0]===positional[0]&&nextPositional[1]===positional[1]);
            check(nextPositional.map(node=>node.textContent).join('|')==='0:a|1:b|2:c');return;
          }
          button.click(); await settle();
          check(main.querySelector(fixture === 'composition' ? 'strong' : 'p')!.textContent === '1');
        }, row.fixture);
        if (errors.length) throw new Error(errors.join('\n'));
      } catch (error) {
        throw new Error(`${row.fixture}/${row.graph}: ${errors.join('\n') || String(error)}`, { cause: error });
      } finally { await page.close(); }
    }
    console.log(`Verified ${rows.length} browser graphs: interactions, duplicate input values and retained list identity.`);
    lines.push(`All ${rows.length} browser graphs passed interaction checks. Input/list checks include whitespace rejection, duplicate values, input reset and retained row identity. Keyed reverse preserves nodes.`, '');
  } finally {
    try { await browser.close(); } finally { server.stop(true); }
  }
}
for (const row of rows.filter(row => row.graph !== 'package')) {
  lines.push(`## ${row.fixture}: ${row.graph} attribution`, '', '| Input | Minified bytes |', '|---|---:|',
    ...row.inputs.map(input => `| ${input.path} | ${input.bytes} |`), '');
}
writeFileSync(resolve(directory, 'results.json'), JSON.stringify({ measuredAt: new Date().toISOString(),
  revision, status, baseline, hydration, baselineProgramHydration, verified: process.argv.includes('--verify'), rows }, null, 2));
writeFileSync(resolve(directory, 'results.md'), lines.join('\n') + '\n');
console.log(`Report: ${resolve(directory, 'results.md')}`);
