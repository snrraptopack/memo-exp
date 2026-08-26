import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '@memoized-dom/compiler';
import { renderToResult, renderToResultAsync } from '@memoized-dom/server';

const PORT = Number(process.env.PORT || 3000);
const dir = import.meta.dirname;

// 1. Compile universal component with memoized-dom compiler
const source = readFileSync(join(dir, 'SsrApp.tsx'), 'utf8');
const compiledJs = compile(source, { runtimePath: '@memoized-dom/runtime' });

// 2. Server evaluator
const blobUrl = 'data:text/javascript;base64,' + Buffer.from(compiledJs).toString('base64');
const mod = await import(blobUrl);
const SsrApp = mod.SsrAppApp;

// 3. Client bundle generated via standalone browser build
const runtimeChunk = readFileSync(join(dir, '../../packages/runtime/dist/chunks/src-CxOorTBN.js'), 'utf8');

const clientBundleCode = `
${runtimeChunk}

${compiledJs.replace(/import\s*\*\s*as\s*_MD\s*from\s*['"][^'"]+['"];?/g, '')}

registerRootFactory(SsrAppApp, {
  id: 'App',
  create: () => SsrAppApp('App', null),
});

hydrate('root', SsrAppApp, { recover: true });
console.log('⚡ [memoized-dom] Client hydrated successfully and live reactivity resumed');
`;

console.log(`\n⚡ Memoized DOM Universal SSR Server running on http://localhost:${PORT}\n`);
console.log(`- Full Hydration SSR:   http://localhost:${PORT}/`);
console.log(`- Pure Static HTML:     http://localhost:${PORT}/?markers=false`);
console.log(`- Async Settle SSR:     http://localhost:${PORT}/?async=true\n`);

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Serve static css
    if (url.pathname === '/styles.css') {
      return new Response(Bun.file(join(dir, 'styles.css')), {
        headers: { 'content-type': 'text/css' },
      });
    }

    // Serve client bundle
    if (url.pathname === '/client.js' || url.pathname.endsWith('/client.js')) {
      return new Response(clientBundleCode, {
        headers: { 'content-type': 'application/javascript; charset=utf-8' },
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
    <title>Memoized DOM — Universal SSR & Hydration</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <!-- SSR Server rendered in ${duration}ms (markers: ${useMarkers}) -->
    <div id="root">${result.html}</div>
    ${
      useMarkers
        ? `<!-- Scoped DOM-embedded JSON state payload channel (RFC §16.6) -->
    ${result.scriptTag}
    <!-- Client hydration bundle -->
    <script type="module" src="/client.js"></script>`
        : `<!-- Static HTML mode (zero hydration comments, no JS loaded) -->`
    }
  </body>
</html>`;

    return new Response(fullHtml, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-rendered-in': `${duration}ms`,
      },
    });
  },
});
