import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { compile } from '@memoized-dom/compiler';
import { renderToResult, renderToResultAsync } from '@memoized-dom/server';

const PORT = Number(process.env.PORT || 3000);
const dir = import.meta.dirname;
const cacheDir = join(dir, '.cache');
mkdirSync(cacheDir, { recursive: true });

// 1. Compile universal component with memoized-dom compiler
const source = readFileSync(join(dir, 'SsrApp.tsx'), 'utf8');
const compiledJs = compile(source, { runtimePath: '@memoized-dom/runtime' });

// 2. Server evaluator
const blobUrl = 'data:text/javascript;base64,' + Buffer.from(compiledJs).toString('base64');
const mod = await import(blobUrl);
const SsrApp = mod.SsrAppApp;

// 3. Build minified browser client bundle with idle hydration
const entryFile = join(cacheDir, 'bundle-entry.js');
const entryCode = `
${compiledJs}

_MD.registerRootFactory(SsrAppApp, {
  id: "App",
  create: () => SsrAppApp("App", null),
});

// Macro-task hydration: yields main thread to achieve 0ms TBT and 100 Performance
setTimeout(() => {
  _MD.hydrate("root", SsrAppApp, { recover: true });
}, 0);
`;
writeFileSync(entryFile, entryCode);

const build = await Bun.build({
  entrypoints: [entryFile],
  target: 'browser',
  format: 'esm',
  minify: true,
});

const clientBundleCode = await build.outputs[0]?.text() ?? '';
const clientBundleGzip = gzipSync(Buffer.from(clientBundleCode, 'utf8'));

// Inlined CSS for zero render-blocking requests
const cssRaw = readFileSync(join(dir, 'styles.css'), 'utf8');

console.log(`\n⚡ Memoized DOM Universal SSR Server running on http://localhost:${PORT}\n`);
console.log(`- Bundle size:          ${(clientBundleCode.length / 1024).toFixed(1)} KB (raw) / ${(clientBundleGzip.length / 1024).toFixed(1)} KB (gzip)`);
console.log(`- Full Hydration SSR:   http://localhost:${PORT}/`);
console.log(`- Pure Static HTML:     http://localhost:${PORT}/?markers=false`);
console.log(`- Async Settle SSR:     http://localhost:${PORT}/?async=true\n`);

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const acceptEncoding = req.headers.get('accept-encoding') || '';
    const supportsGzip = acceptEncoding.includes('gzip');

    // Serve client hydration bundle
    if (url.pathname === '/client.js' || url.pathname.endsWith('/client.js')) {
      if (supportsGzip) {
        return new Response(clientBundleGzip, {
          headers: {
            'content-type': 'application/javascript; charset=utf-8',
            'content-encoding': 'gzip',
            'cache-control': 'public, max-age=31536000, immutable',
          },
        });
      }
      return new Response(clientBundleCode, {
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    }

    // Determine marker mode: ?markers=false or ?clean=true
    const useMarkers = url.searchParams.get('clean') !== 'true' && url.searchParams.get('markers') !== 'false';
    const isAsync = url.searchParams.get('async') === 'true';

    const start = performance.now();
    const result = isAsync
      ? await renderToResultAsync(SsrApp, {
          url: req.url,
          markers: useMarkers,
          mode: 'resolve',
        })
      : renderToResult(SsrApp, {
          url: req.url,
          markers: useMarkers,
        });

    const duration = (performance.now() - start).toFixed(2);

    const fullHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Memoized DOM Universal SSR and Hydration demo with zero-cost fine-grained reactivity." />
    <title>Memoized DOM — Universal SSR & Hydration</title>
    <style>${cssRaw}</style>
    ${useMarkers ? `<link rel="modulepreload" href="/client.js" />` : ''}
  </head>
  <body>
    <!-- SSR Server rendered in ${duration}ms (markers: ${useMarkers}) -->
    <div id="root">${result.html}</div>
    ${
      useMarkers
        ? `<!-- Scoped DOM-embedded JSON state payload channel (RFC §16.6) -->
    ${result.scriptTag}
    <!-- Client hydration bundle: idle adoption -->
    <script type="module" src="/client.js" defer></script>`
        : `<!-- Static HTML mode (zero hydration comments, no JS loaded) -->`
    }
  </body>
</html>`;

    const htmlBuffer = Buffer.from(fullHtml, 'utf8');

    if (supportsGzip) {
      const gzippedHtml = gzipSync(htmlBuffer);
      return new Response(gzippedHtml, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-encoding': 'gzip',
          'x-rendered-in': `${duration}ms`,
        },
      });
    }

    return new Response(htmlBuffer, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-rendered-in': `${duration}ms`,
      },
    });
  },
});
