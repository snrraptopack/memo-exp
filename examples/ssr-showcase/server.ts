/**
 * Server entry — Web handler contract.
 *
 * The fullstack Vite plugin loads this via `ssrLoadModule` so every request
 * that Vite does not handle as a module or asset lands here. Two concerns:
 *
 *   /api/*  → mock JSON with simulated latency (swap for a real DB in prod).
 *   *       → server-render the application, stream the document.
 *
 * The streaming shape is:
 *   HTML prefix (head + opening body + <div id="root">)
 *   ↓  renderToReadableStream settles all data, emits resolved HTML + payload
 *   HTML suffix (</div> + <script type="module"> + closing tags)
 *
 * The payload script tag travels inside the stream body; `hydrate` finds it
 * via `document.querySelector` regardless of where it sits in the DOM.
 */
import { readFileSync } from 'node:fs';
import { renderToReadableStream } from '@memoized-dom/server';
import { createDocumentStream, htmlResponse } from '@memoized-dom/adapters';
import { App } from './App';
import './session';

// ---------------------------------------------------------------------------
// Document template — split once at startup, reused per request.
// ---------------------------------------------------------------------------

const template = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const [rawPrefix, rawSuffix] = template.split('<!--ssr-outlet-->');

if (rawSuffix === undefined) {
  throw new Error(
    "server.ts: index.html is missing the <!--ssr-outlet--> marker",
  );
}

const prefix = rawPrefix!;
const suffix = rawSuffix;

// ---------------------------------------------------------------------------
// Mock data — realistic shapes, simulated network latency.
// ---------------------------------------------------------------------------

const SESSION = { name: 'Ada Lovelace', role: 'admin', avatar: 'A' };

const STORIES = [
  {
    id: 1,
    title: 'Memoized DOM ships streaming SSR with payload transport',
    category: 'Release',
    author: 'team',
    votes: 42,
    posted: '2h ago',
  },
  {
    id: 2,
    title: 'How colorless async modules eliminate data-fetching boilerplate',
    category: 'Guide',
    author: 'ada',
    votes: 31,
    posted: '5h ago',
  },
  {
    id: 3,
    title: 'Rolldown + OXC: instant cold starts for large graphs',
    category: 'Performance',
    author: 'team',
    votes: 27,
    posted: '1d ago',
  },
  {
    id: 4,
    title: 'Hydration without tears: the payload envelope explained',
    category: 'Deep dive',
    author: 'ada',
    votes: 19,
    posted: '2d ago',
  },
];

/** Simulate a small network round-trip so SSR latency is observable. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mockFetch(input: RequestInfo | URL): Promise<Response> {
  const pathname = new URL(String(input), 'http://localhost').pathname;

  if (pathname === '/api/session') {
    await delay(40);
    return Response.json(SESSION);
  }

  if (pathname === '/api/stories') {
    await delay(80);
    return Response.json(STORIES);
  }

  return new Response('Not found', { status: 404 });
}

// ---------------------------------------------------------------------------
// API handler — direct JSON, no SSR needed.
// ---------------------------------------------------------------------------

async function handleApi(pathname: string): Promise<Response> {
  if (pathname === '/api/session') {
    await delay(40);
    return Response.json(SESSION);
  }
  if (pathname === '/api/stories') {
    await delay(80);
    return Response.json(STORIES);
  }
  return Response.json({ error: 'not found' }, { status: 404 });
}

// ---------------------------------------------------------------------------
// Web handler — the single export the fullstack plugin looks for.
// ---------------------------------------------------------------------------

export async function fetch(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // API routes bypass SSR entirely.
  if (url.pathname.startsWith('/api/')) {
    return handleApi(url.pathname);
  }

  // Every other GET renders the application. Non-GET (e.g. form actions) is
  // not implemented in this example — return a plain 405.
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  // renderToReadableStream:
  //   - `url`     → memory route history initialised to this pathname so
  //                 route.pathname returns the request path during render.
  //   - `fetch`   → per-request data function; module sources call this
  //                 instead of the browser fetch during SSR.
  //   - `markers` → embeds <!--mmd:r:App--> / <!--/mmd--> boundary comments
  //                 that the client hydration cursor relies on.
  //   - `mode`    → 'resolve' settles all async sources before serializing;
  //                 the stream emits one fully-resolved chunk (no shell/swap).
  const body = renderToReadableStream(App, {
    url: url.pathname + url.search,
    fetch: mockFetch as typeof globalThis.fetch,
    markers: true,
    mode: 'resolve',
  });

  return htmlResponse(
    createDocumentStream({ prefix, body, suffix }),
    // Allow an upstream CDN / edge cache to serve the rendered document while
    // the stale-while-revalidate window keeps it fresh in the background.
    { headers: { 'cache-control': 'public, max-age=5, stale-while-revalidate=60' } },
  );
}
