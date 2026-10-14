/** Real Vite outputs and the cached native host, without linking during JS tests. */
import { expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { buildDesktopEngine, buildDesktopRunner, desktopApplicationConfig } from '../src/dev/vite';

const native = fileURLToPath(new URL('../rust/target/debug/memoized-dom-desktop' +
  (process.platform === 'win32' ? '.exe' : ''), import.meta.url));

test('Vite CSS plugins, imported cells, normal mount and root replacement share one native connection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'memoized-blitz-vite-'));
  const outDir = join(directory, 'dist');
  await writeFile(join(directory, 'state.ts'), `
    export let count = 0;
    export function increment() { count++; }
  `);
  await writeFile(join(directory, 'Summary.tsx'), `
    import { Frame } from './Frame';
    export function Summary({ count }) {
      const content = <aside>Imported native child: {count}</aside>;
      return <Frame {...{ content }} />;
    }
  `);
  await writeFile(join(directory, 'Frame.tsx'), `
    export function Frame({ content }) {
      return <section>{content}</section>;
    }
  `);
  await writeFile(join(directory, 'App.tsx'), `
    import './style.css';
    import { count, increment } from './state';
    import { Summary } from './Summary';
    export function App() {
      return <main class="counter"><button onClick={increment}>Increment</button><p>{count}</p><Summary count={count} /></main>;
    }
  `);
  await writeFile(join(directory, 'main.ts'), `
    import { mount } from '@memoized-dom/runtime';
    import { App } from './App';
    mount('fixture', App);
  `);
  await writeFile(join(directory, 'style.css'), '.counter { padding: 13px; color: red; }');
  const options = {
    root: directory,
    entry: 'main.ts',
    outDir,
    vite: {
      logLevel: 'silent' as const,
      plugins: [{
        name: 'test-css-transform',
        enforce: 'pre' as const,
        transform(code: string, id: string) {
          return id.endsWith('style.css') ? code.replace('red', 'rebeccapurple') : null;
        },
      }],
    },
  };
  await buildDesktopEngine(options);
  await build(desktopApplicationConfig(options));
  const manifest = JSON.parse(await readFile(join(outDir, 'desktop.json'), 'utf8'));
  expect(manifest).toMatchObject({ version: 1, mountTarget: 'fixture', stylesheets: ['application.css'] });
  expect(manifest.entry).toMatch(/^application-.*\.mjs$/);
  const css = await readFile(join(outDir, 'application.css'), 'utf8');
  expect(css).toContain('padding:13px');
  expect(css).not.toContain('color:red');
  const engine = await import(pathToFileURL(join(outDir, 'engine.mjs')).href);
  const host = engine.openApplication(native, 'fixture', true);
  const load = () => import(pathToFileURL(join(outDir, manifest.entry)).href);
  try {
    await host.replace([{ source: 'application.css', css, revision: 'one' }], load);
    const first = host.adapter.view();
    const button = first.template.nodes.findIndex((source: { node: { kind: string; name?: { local: string } } }) =>
      source.node.kind === 'element' && source.node.name?.local === 'button');
    first.dispatch(button, 'onClick', new Event('click'));
    await Bun.sleep(0);
    // The root text and imported child are separate accepted view updates.
    expect((await first.publication()).sequence).toBe(3);
    const firstValues = first.frame.application.run(() => first.evaluate());
    expect(firstValues.some((step: { kind: string; value: unknown }) => step.kind === 'text' && step.value === 1)).toBe(true);
    await host.replace([]);
    const next = host.adapter.view();
    expect(next.frame.owner.generation).toBe(2);
    expect(next.template.nodes.some((source: { node: { name?: { local: string } } }) => source.node.name?.local === 'style')).toBe(false);
    const nextValues = next.frame.application.run(() => next.evaluate());
    expect(nextValues.some((step: { kind: string; value: unknown }) => step.kind === 'text' && step.value === 1)).toBe(true);
    await host.replace([], load);
    expect(host.adapter.view().frame.owner.generation).toBe(3);
  } finally {
    host.close();
  }
  await buildDesktopRunner(options);
  for (const runtime of ['bun', 'node']) {
    const child = Bun.spawn([runtime, join(outDir, 'runner.mjs'), outDir, native, '--headless'], {
      stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    });
    const output = child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    async function line(): Promise<string> {
      while (!buffered.includes('\n')) {
        const next = await output.read();
        if (next.done) throw new Error('Runner closed before reporting acceptance');
        buffered += decoder.decode(next.value, { stream: true });
      }
      const end = buffered.indexOf('\n');
      const result = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      return result;
    }
    try {
      expect(await line()).toContain('Desktop root accepted (revision 1');
      child.stdin.write('reload\n');
      expect(await line()).toContain('Desktop root accepted (revision 2');
      child.stdin.end();
      const errors = await new Response(child.stderr).text();
      expect(await child.exited).toBe(0);
      expect(errors).toBe('');
    } finally {
      output.releaseLock();
      child.kill();
    }
  }
  // This temporary build is retained for diagnosing a failed contract; it
  // contains only generated fixture source, never an application dependency.
  expect(resolve(outDir).startsWith(resolve(directory))).toBe(true);
}, 30_000);
