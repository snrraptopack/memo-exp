/**
 * SSR marker serialization — Phase 2 groundwork.
 *
 * The serializer's comment policy is the contract hydration adoption builds
 * on: runtime region anchors (conditional `when:`, list `list:`) are
 * structural identity, so `markers: true` must preserve them everywhere —
 * including bare top-level anchors that element `outerHTML` cannot cover —
 * while `markers: false` (the default until client adoption ships) strips
 * them all for clean host-consumable HTML.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import { renderToString } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const fixture = join(outDir, 'markers.compiled.ts');

const source = `
  export function App() {
    const open = 3;
    const todos = ['Alpha', 'Beta'];

    return (
      <main>
        <p if={open > 0}>{open} open</p>
        <ul>
          {todos.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <footer>static</footer>
      </main>
    );
  }
`;

function comments(html: string): string[] {
  return [...html.matchAll(/<!--([\s\S]*?)-->/g)].map(
    (match) => match[1]!,
  );
}

describe('SSR marker serialization', () => {
  let App: any;

  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    const output = compileModules(
      { './markers.tsx': source },
      { runtimePath: '@memoized-dom/runtime' },
    );
    writeFileSync(fixture, output['./markers.tsx']!);
  });

  it('loads the compiled fixture', async () => {
    const mod = await import(pathToFileURL(fixture).href);
    App = mod.App;
    expect(typeof App).toBe('function');
  });

  it('strips every anchor by default for clean host HTML', async () => {
    
    const html = renderToString(App);
    expect(html).toContain('<li>Alpha</li>');
    expect(html).not.toContain('<!--');
    expect(comments(html)).toEqual([]);
  });

  it('preserves structural anchors with markers enabled', async () => {
    
    const html = renderToString(App, { markers: true });

    const bodies = comments(html);
    // Hydration protocol grammar (hydration-markers.md §2/§3): conditional
    // regions open with `mmd:g:`, keyed lists with `mmd:l:`, rows with
    // `mmd:w:`, the application root with `mmd:r:` — and every range closes
    // with the uniform `/mmd` marker.
    expect(bodies.some((body) => body.startsWith('mmd:g:'))).toBe(true);
    expect(bodies.some((body) => body.startsWith('mmd:l:'))).toBe(true);
    expect(bodies.some((body) => body.startsWith('mmd:w:'))).toBe(true);
    expect(bodies.some((body) => body.startsWith('mmd:r:'))).toBe(true);
    expect(
      bodies.filter((body) => body === '/mmd').length,
    ).toBeGreaterThanOrEqual(3);
    // Content is unchanged by the marker mode.
    expect(html).toContain('<footer>static</footer>');
  });

  it('serializes top-level anchors instead of leaking them as text', async () => {
    
    const html = renderToString(App, { markers: true });
    // Historical bug: bare top-level anchors fell through to textContent and
    // leaked as raw "when:..." text. Anchors must only ever appear inside
    // well-formed comments.
    expect(html).not.toMatch(/(>|^)when:/);
    expect(html).not.toMatch(/(>|^)list:/);
  });

  it('is deterministic per mode', async () => {
    
    expect(renderToString(App, { markers: true })).toBe(
      renderToString(App, { markers: true }),
    );
    expect(renderToString(App)).toBe(renderToString(App));
    expect(renderToString(App, { markers: true })).not.toBe(
      renderToString(App),
    );
  });
});
