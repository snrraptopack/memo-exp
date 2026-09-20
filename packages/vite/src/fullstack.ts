import {
  sendNodeResponse,
  toWebRequest,
} from '@memoized-dom/adapters/node';
import type { WebHandler } from '@memoized-dom/adapters';
import type { ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serverFunctionsVirtualId } from './server-functions';
import { clientStyleUrls } from './dev-assets';

interface FullstackModule {
  readonly default?: unknown;
}

interface InstallableApplication {
  fetch: WebHandler;
  installServerFunctions?: (routes: readonly unknown[]) => void;
  installDocumentTemplate?: (template: string) => void;
}

interface GeneratedServerFunctionModule {
  readonly serverFunctionRoutes?: unknown;
}

function handlerFromModule(
  module: FullstackModule,
  entry: string,
): InstallableApplication {
  const candidate = module.default as Partial<InstallableApplication> | undefined;
  if (candidate === undefined || typeof candidate.fetch !== 'function') {
    throw new TypeError(
      `memoized-dom: fullstack entry '${entry}' must default-export the application returned by serve()`,
    );
  }
  return candidate as InstallableApplication;
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
  const module = await server.ssrLoadModule(
    moduleId(entry),
  ) as FullstackModule;
  const application = handlerFromModule(module, entry);
  if (application.installServerFunctions !== undefined) {
    const generated = await server.ssrLoadModule(
      serverFunctionsVirtualId,
    ) as GeneratedServerFunctionModule;
    if (!Array.isArray(generated.serverFunctionRoutes)) {
      throw new TypeError(
        'memoized-dom: generated server-function manifest did not export a route array',
      );
    }
    application.installServerFunctions(generated.serverFunctionRoutes);
  }
  if (application.installDocumentTemplate !== undefined) {
    const source = await readFile(
      resolve(server.config.root, 'index.html'),
      'utf8',
    ).catch(() => undefined);
    if (source !== undefined) {
      const path = request.url ?? '/';
      application.installDocumentTemplate(
        await server.transformIndexHtml(path, source),
      );
    }
  }
  const handled = await application.fetch(toWebRequest(request));
  const styles = handled.headers
    .get('content-type')
    ?.toLowerCase()
    .includes('text/html')
      ? await clientStyleUrls(server)
      : [];
  await sendNodeResponse(injectClientStyles(handled, styles), response);
}

function styleLink(url: string): string {
  const escaped = url.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  return `<link rel="stylesheet" href="${escaped}" data-memoized-dom-dev>`;
}

/** Inject links while buffering only the document head, not the application stream. */
function injectClientStyles(
  response: Response,
  styles: readonly string[],
): Response {
  if (
    styles.length === 0 ||
    response.body === null ||
    !response.headers.get('content-type')?.toLowerCase().includes('text/html')
  ) return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';
  let injected = false;
  const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      if (injected) {
        controller.enqueue(encoder.encode(text));
        return;
      }
      pending += text;
      const close = /<\/head\s*>/i.exec(pending);
      if (close === null) return;
      const links = styles
        .filter(url => !pending.includes(`href="${url}"`))
        .map(styleLink)
        .join('');
      const index = close.index;
      controller.enqueue(encoder.encode(
        `${pending.slice(0, index)}${links}${pending.slice(index)}`,
      ));
      pending = '';
      injected = true;
    },
    flush(controller) {
      pending += decoder.decode();
      if (pending !== '') controller.enqueue(encoder.encode(pending));
    },
  }));
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function middleware(server: ViteDevServer, entry: string) {
  return async function memoizedDomServerMiddleware(
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
export function configureFullstackServer(
  server: ViteDevServer,
  entry: string,
): () => void {
  return () => {
    server.middlewares.use(middleware(server, entry));
  };
}
