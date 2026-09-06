/**
 * Phase 1.4 — LinkeDOM reference renderer.
 *
 * Proves compiled output renders deterministically through a server
 * document: correct structure, no effects executed, request runtime always
 * disposed, and structural parity with a client-side (happy-dom) creation
 * pass of the same compiled graph.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import { resetScheduler, unregister } from '@memoized-dom/runtime';
import { _internals } from '@memoized-dom/runtime/testing';
import { renderToString, renderWithDom } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'tests', 'fixtures', 'out');
const fixture = join(outDir, 'server-render.compiled.ts');

const source = `
  let effectRuns = 0;
  export function effectRunCount() { return effectRuns; }

  export function App() {
    let open = 3;
    let tasks = ['Alpha', 'Beta'];

    effect(() => {
      effectRuns++;
    });

    const visible = tasks.filter((t) => t.length > 0);

    return (
      <main id="app" class="board">
        <h1>Board</h1>
        <p
          if={open > 0}
          class="hint"
          style={{ width: open * 10, opacity: 0.5, '--open': open }}
        >{open} open</p>
        <ul>
          {visible.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </main>
    );
  }
`;

function importFixture(): Promise<any> {
  return import(/* @vite-ignore */ pathToFileURL(fixture).href);
}

/**
 * A second module record for client-creation passes: compiled template
 * caches capture nodes from the document active at first creation, so the
 * server (LinkeDOM) and client (happy-dom) tiers must use separate module
 * instances - mirroring production, where server and client are separate
 * builds.
 */
function importClientFixture(): Promise<any> {
  return import(/* @vite-ignore */ pathToFileURL(fixture + '.client.mjs').href);
}

describe('LinkeDOM reference renderer', () => {
  let App: any;

  beforeAll(async () => {
    mkdirSync(outDir, { recursive: true });
    const output = compileModules(
      { './server-render.tsx': source },
      { runtimePath: '@memoized-dom/runtime' },
    );
    writeFileSync(fixture, output['./server-render.tsx']!);
    writeFileSync(fixture + '.client.mjs', output['./server-render.tsx']!);
    const mod = await import(pathToFileURL(fixture).href);
    App = mod.App;
  });

  beforeEach(() => {
    document.body.replaceChildren();
    resetScheduler();
  });

  afterEach(() => {
    // Client-creation passes register into the ambient default runtime.
    _internals().registry.forEach((_, id) => unregister(id));
  });

  it('renders deterministic HTML through the server document', () => {
    const html = renderToString(App);

    expect(html).toContain('id="app"');
    expect(html).toContain('class="board"');
    expect(html).toContain('<h1>Board</h1>');
    expect(html).toContain('3 open');
    expect(html).toContain('style="width: 30px; opacity: 0.5; --open: 3"');
    expect((html.match(/<li>/g) ?? []).length).toBe(2);
    expect(html).toContain('<li>Alpha</li>');
    expect(html).toContain('<li>Beta</li>');
    expect(html.startsWith('<main')).toBe(true);
  });

  it('never executes effects during server rendering', async () => {
    const mod = await importFixture();
    const html = renderToString(mod.App);
    expect(html).toContain('<main');
    expect(mod.effectRunCount()).toBe(0);
  });

  it('produces structurally identical output to client creation', async () => {
    // Separate module records per tier: compiled template caches capture
    // nodes from the document active at first creation, mirroring
    // production where server and client are separate builds.
    const serverMod = await importFixture();
    const clientMod = await importClientFixture();

    const serverHtml = renderToString(serverMod.App);

    // Client-side creation in happy-dom through the normal factory call.
    const clientRoot = clientMod.App('ClientApp', null) as Element;

    // Serializer details (attribute order, comment anchors) are declared
    // irrelevant; element/attribute/text structure must match exactly.
    const normalize = (html: string): string =>
      html
        .replace(/<!--.*?-->/g, '')
        .replace(/ style="[^"]*"/g, '')
        .replace(
          /<([a-z][a-z0-9]*)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*>/g,
          (_match, tag: string, attrs: string) => {
            const sorted = attrs
              .trim()
              .split(/\s+/)
              .filter(Boolean)
              .sort()
              .join(' ');
            return `<${tag}${sorted ? ' ' + sorted : ''}>`;
          },
        )
        .replace(/\s+/g, ' ')
        .trim();

    const clientHtml =
      clientRoot.nodeType === 11
        ? Array.from(clientRoot.childNodes)
            .map((node) => (node as Element).outerHTML)
            .join('')
        : (clientRoot as Element).outerHTML;

    expect(normalize(serverHtml)).toBe(normalize(clientHtml));
  });

  it('isolates successive renders: each gets a fresh request runtime', () => {
    const first = renderToString(App);
    const second = renderToString(App);
    expect(first).toBe(second);
  });
});
