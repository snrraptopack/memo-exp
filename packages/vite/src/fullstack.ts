import {
  sendNodeResponse,
  toWebRequest,
} from '@memoized-dom/adapters/node';
import type { WebHandler } from '@memoized-dom/adapters';
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface MemoizedDomFullstackOptions {
  /** Vite-root-relative server module exporting `fetch` or a default handler. */
  readonly entry: string;
}

interface FullstackModule {
  readonly default?: unknown;
  readonly fetch?: unknown;
}

function handlerFromModule(
  module: FullstackModule,
  entry: string,
): WebHandler {
  const candidate = module.fetch ?? module.default;
  if (typeof candidate !== 'function') {
    throw new TypeError(
      `memoized-dom: fullstack entry '${entry}' must export a Web handler as 'fetch' or default`,
    );
  }
  return candidate as WebHandler;
}

function moduleId(entry: string): string {
  return entry.startsWith('/') ? entry : `/${entry}`;
}

async function dispatch(
  server: ViteDevServer,
  entry: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const module = await server.ssrLoadModule(moduleId(entry)) as FullstackModule;
  const handler = handlerFromModule(module, entry);
  await sendNodeResponse(await handler(toWebRequest(request)), response);
}

function middleware(server: ViteDevServer, entry: string) {
  return async function memoizedDomFullstackMiddleware(
    request: IncomingMessage,
    response: ServerResponse,
    next: (error?: unknown) => void,
  ): Promise<void> {
    try {
      await dispatch(server, entry, request, response);
    } catch (error) {
      if (error instanceof Error) server.ssrFixStacktrace(error);
      next(error);
    }
  };
}

/**
 * Install a post-Vite Web-handler boundary for fullstack development.
 *
 * Vite owns HMR and module/assets. Requests that remain are converted from
 * Node HTTP to the Web Request/Response contract and dispatched through the
 * application server entry loaded by `ssrLoadModule`.
 */
export function memoizedDomFullstack(
  options: MemoizedDomFullstackOptions,
): Plugin {
  return {
    name: 'memoized-dom-fullstack',
    apply: 'serve',
    configureServer(server) {
      return () => {
        server.middlewares.use(middleware(server, options.entry));
      };
    },
  };
}
