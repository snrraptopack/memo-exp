import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compile } from '@memoized-dom/compiler';
import { renderToString } from '@memoized-dom/server';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const output = join(outDir, 'ssr-overhead.compiled.ts');

const SOURCE = `
let user = { name: 'Ada', loggedIn: true };
let items = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, title: 'Item ' + (i + 1) }));

function Row(item) {
  return <li>{item.title}</li>;
}

export function App() {
  return (
    <main>
      <header>
        <h1>Dashboard</h1>
        {user.loggedIn ? <span>Welcome, {user.name}</span> : <span>Guest</span>}
      </header>
      <section>
        <ul>
          {items.map((item) => <Row item={item} key={item.id} />)}
        </ul>
      </section>
    </main>
  );
}
`;

interface CompiledApp {
  App(id: string, parent: null): Node;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(output, compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }));

async function importCompiled(): Promise<CompiledApp> {
  return import(/* @vite-ignore */ pathToFileURL(output).href);
}

describe('SSR Marker Overhead Measurement (Phase 2 & Phase 3 Budget)', () => {
  it('measures marker overhead on a 50-row list + conditional tree', async () => {
    const app = await importCompiled();

    const plainHtml = renderToString(app.App, { markers: false });
    const markedHtml = renderToString(app.App, { markers: true });

    const plainBytes = Buffer.byteLength(plainHtml, 'utf8');
    const markedBytes = Buffer.byteLength(markedHtml, 'utf8');
    const markerOverheadBytes = markedBytes - plainBytes;
    const overheadRatio = markerOverheadBytes / plainBytes;

    // Ensure markers are present in marked output
    expect(markedHtml).toContain('<!--mmd:r:App-->');
    expect(markedHtml).toContain('<!--mmd:l:');
    expect(markedHtml).toContain('<!--mmd:w:');
    expect(markedHtml).toContain('<!--/mmd-->');

    // Ensure markers are completely stripped in plain output
    expect(plainHtml).not.toContain('<!--mmd:');
    expect(plainHtml).not.toContain('<!--/mmd-->');

    // Overhead assertions: for a short-text list (<li>Item N</li>), compact markers
    // add ~35 bytes per row (`<!--mmd:w:App/items:n:N-->`), bounding ratio < 2.0.
    expect(overheadRatio).toBeLessThan(2.0);
    expect(plainBytes).toBeGreaterThan(500);
  });
});
