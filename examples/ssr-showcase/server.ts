/**
 * Server entry — the composed application server (`defineServer`).
 *
 * The fullstack Vite plugin loads this module and serves every request the
 * dev server does not handle as an asset. One declarative block owns the
 * whole backend:
 *
 *   /api/*   → JSON endpoints. The same routes serve browser requests and
 *              in-memory SSR dispatch (no loopback, no mock duplication).
 *   *        → page fallthrough: prefix middleware, then SSR of `App` with
 *              the render policy (resolved SSR + hydration markers).
 *
 * The SSR data path: colorless module sources (`./session`) call `$fetch`
 * during render, `defineServer` dispatches those calls in-process through
 * this same route table and middleware, and the resolved state travels to
 * the client in the `application/mmd+json` payload.
 */
import { defineServer } from '@memoized-dom/server';
import { App } from './App';

// ---------------------------------------------------------------------------
// Data — the single source both SSR and the browser read.
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

// ---------------------------------------------------------------------------
// Middleware — cross-cutting concerns live once (RFC §4).
// ---------------------------------------------------------------------------

/** Simulate network latency per pathname so SSR latency stays observable. */
function devDelay(
  map: Record<string, number>,
): (context: { request: Request }, next: () => Promise<Response>) => Promise<Response> {
  return async (context, next) => {
    const ms = map[new URL(context.request.url).pathname];
    if (ms !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    return next();
  };
}

// ---------------------------------------------------------------------------
// The whole backend in one declarative block.
// ---------------------------------------------------------------------------

export default defineServer({
  // The root compiled UI component — rendered for every page fallthrough.
  app: App,

  // Page template: loaded, validated for <!--ssr-outlet-->, and split once
  // at definition time.
  document: new URL('./index.html', import.meta.url),

  // Prefix group middleware — applies to /api/* endpoints AND to in-memory
  // SSR dispatch of those endpoints, so server rendering observes the same
  // latency a real browser request would.
  routes: {
    '/api/*': {
      middleware: [
        devDelay({ '/api/session': 40, '/api/stories': 80 }),
      ],
    },

    // A bare handler is GET; object/array responses serialize to JSON.
    '/api/session': () => SESSION,
    '/api/stories': () => STORIES,
  },

  // Default ResponseInit applied to rendered HTML pages — lets an upstream
  // CDN serve the document while stale-while-revalidate refreshes it.
  init: {
    headers: {
      'cache-control': 'public, max-age=5, stale-while-revalidate=60',
    },
  },

  // Rendering policy (defaults shown): resolve request data before flush,
  // emit hydration markers plus the application/mmd+json payload, and
  // stream the ordered document.
  render: {
    mode: 'resolve',
    markers: true,
    delivery: 'stream',
  },
});
