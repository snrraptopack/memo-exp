/**
 * Internal application request handler.
 *
 * Combines normalized routes, middleware, page rendering, and the
 * same-origin in-memory `$fetch` bridge behind serve().
 */
import { createStorage } from '@memoized-dom/runtime/server';
import {
  createServerRouter,
  type RegisteredServerLocals,
  type RegisteredServerPlatform,
  type RegisteredServerServices,
  type ServerContext,
  type ServerMiddleware,
  type ServerMiddlewareGroup,
  type ServerRoute,
  type ServerRouter,
} from './http-router';
import {
  composeDocumentStream,
  loadDocumentTemplate,
  splitDocumentTemplate,
  type DocumentTemplate,
} from './document';
import {
  renderToResultAsync,
  renderToStringAsync,
  type RenderOptions,
  type ServerComponent,
} from './index';
import { prepareRenderToReadableStream } from './stream';

export interface ApplicationRenderPolicy {
  /** Resolve request data before output, or emit the immediate pending shell. */
  readonly mode?: RenderOptions['mode'];
  /** Emit hydration anchors and the serialized data payload. */
  readonly markers?: boolean;
  /** Resolve-mode quiescence budget in milliseconds. */
  readonly timeout?: number;
  /** Stream the ordered document or buffer it before returning. */
  readonly delivery?: 'stream' | 'buffer';
}

export interface ApplicationHandlerOptions<
  TLocals extends object = RegisteredServerLocals,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
> {
  readonly resolveApp?: (
    context: ServerContext<TLocals, TPlatform, TServices>,
  ) => ServerComponent | undefined;
  readonly document?: string | URL;
  readonly documentTemplate?: string;
  readonly middleware?: readonly ServerMiddleware<TLocals, TPlatform, TServices>[];
  readonly routes?: readonly ServerRoute<TLocals, TPlatform, TServices>[];
  readonly groups?: readonly ServerMiddlewareGroup<TLocals, TPlatform, TServices>[];
  readonly render?: ApplicationRenderPolicy;
  readonly init?: ResponseInit;
  readonly createLocals?: (request: Request) => TLocals;
  readonly createPlatform?: (request: Request) => TPlatform | undefined;
  readonly services: TServices;
  readonly fetch?: typeof globalThis.fetch;
  readonly onError?: (
    error: unknown,
    context: ServerContext<TLocals, TPlatform, TServices>,
  ) => Response | Promise<Response>;
}

export type ApplicationHandler = (request: Request) => Promise<Response>;

interface ActiveServerContext {
  readonly context: ServerContext<object, unknown, object>;
  readonly dispatchDepth: number;
}

const activeServerContext = createStorage<ActiveServerContext>(
  'memoized-dom:server-context',
);
const MAX_DISPATCH_DEPTH = 8;
const DEFAULT_TIMEOUT = 10_000;

/** Read the request context from middleware or a server-function body. */
export function getServerContext<
  TLocals extends object = RegisteredServerLocals,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
>(): ServerContext<TLocals, TPlatform, TServices> {
  const active = activeServerContext.getStore();
  if (active === undefined) {
    throw new Error(
      'memo-dom: getServerContext() must be called while serve() is handling a request',
    );
  }
  return active.context as unknown as ServerContext<TLocals, TPlatform, TServices>;
}

function prepareDocument<
  TLocals extends object,
  TPlatform,
  TServices extends object,
>(
  options: ApplicationHandlerOptions<TLocals, TPlatform, TServices>,
): DocumentTemplate | undefined {
  if (options.document !== undefined && options.documentTemplate !== undefined) {
    throw new TypeError(
      'memo-dom: application handler accepts either a document or documentTemplate, not both',
    );
  }
  const template = options.documentTemplate !== undefined
    ? splitDocumentTemplate(options.documentTemplate)
    : options.document !== undefined
      ? loadDocumentTemplate(options.document)
      : undefined;
  if (
    options.resolveApp !== undefined &&
    template === undefined
  ) {
    throw new TypeError(
      'memo-dom: SSR requires a document template',
    );
  }
  return template;
}

function serverContextMiddleware<
  TLocals extends object,
  TPlatform,
  TServices extends object,
>(): ServerMiddleware<TLocals, TPlatform, TServices> {
  return (context, next) => {
    const inheritedDepth = activeServerContext.getStore()?.dispatchDepth ?? 0;
    return activeServerContext.run(
      {
        context: context as unknown as ServerContext<object, unknown, object>,
        dispatchDepth: inheritedDepth,
      },
      next,
    );
  };
}

function createServerFetch<
  TLocals extends object,
  TPlatform,
  TServices extends object,
>(
  router: ServerRouter<TLocals, TPlatform, TServices>,
  parent: ServerContext<TLocals, TPlatform, TServices>,
  hostFetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return ((input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      parent.url,
    );
    const request = input instanceof Request
      ? new Request(input, init)
      : new Request(url, init);
    const sameOriginRoute = url.origin === parent.url.origin &&
      (router.matches(url.pathname, request.method) ||
        router.allowedMethods(url.pathname).length > 0);
    if (!sameOriginRoute) return hostFetch(request);

    const current = activeServerContext.getStore();
    const dispatchDepth = (current?.dispatchDepth ?? 0) + 1;
    if (dispatchDepth > MAX_DISPATCH_DEPTH) {
      return Promise.reject(new Error(
        'memo-dom: in-memory $fetch dispatch exceeded the maximum depth; a route handler appears to fetch itself',
      ));
    }
    return activeServerContext.run(
      {
        context: (current?.context ?? parent) as unknown as ServerContext<
          object,
          unknown,
          object
        >,
        dispatchDepth,
      },
      () => router.dispatch(request, {
        locals: parent.locals,
        ...(parent.platform === undefined ? {} : { platform: parent.platform }),
        services: parent.services,
      }),
    );
  }) as typeof globalThis.fetch;
}

function htmlResponse(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'text/html; charset=utf-8');
  }
  return new Response(body, { ...init, headers });
}

function renderOptions<
  TLocals extends object,
  TPlatform,
  TServices extends object,
>(
  context: ServerContext<TLocals, TPlatform, TServices>,
  options: ApplicationHandlerOptions<TLocals, TPlatform, TServices>,
  router: ServerRouter<TLocals, TPlatform, TServices>,
): Required<Pick<RenderOptions, 'mode' | 'markers' | 'timeout'>> &
Pick<RenderOptions, 'url' | 'fetch'> {
  const policy = options.render ?? {};
  return {
    mode: policy.mode ?? 'resolve',
    markers: policy.markers ?? true,
    timeout: policy.timeout ?? DEFAULT_TIMEOUT,
    url: context.url.pathname + context.url.search,
    fetch: createServerFetch(
      router,
      context,
      options.fetch ?? globalThis.fetch,
    ),
  };
}

async function renderPage<
  TLocals extends object,
  TPlatform,
  TServices extends object,
>(
  context: ServerContext<TLocals, TPlatform, TServices>,
  options: ApplicationHandlerOptions<TLocals, TPlatform, TServices>,
  router: ServerRouter<TLocals, TPlatform, TServices>,
  template: DocumentTemplate | undefined,
): Promise<Response> {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }
  const app = options.resolveApp?.(context);
  if (app === undefined || template === undefined) {
    return new Response('Not Found', { status: 404 });
  }

  const render = renderOptions(context, options, router);
  if ((options.render?.delivery ?? 'stream') === 'buffer') {
    const application = render.markers
      ? await renderToResultAsync(app, render).then(
          result => result.html + result.scriptTag,
        )
      : await renderToStringAsync(app, render);
    return htmlResponse(template.prefix + application + template.suffix, options.init);
  }

  const application = prepareRenderToReadableStream(app, {
    ...render,
    signal: context.request.signal,
  });
  await application.ready;
  return htmlResponse(
    composeDocumentStream({
      prefix: template.prefix,
      body: application.stream,
      suffix: template.suffix,
    }),
    options.init,
  );
}

/** Build the Web handler from serve()'s normalized application declarations. */
export function createApplicationHandler<
  TLocals extends object = RegisteredServerLocals,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
>(
  options: ApplicationHandlerOptions<TLocals, TPlatform, TServices>,
): ApplicationHandler {
  const template = prepareDocument(options);
  let router: ServerRouter<TLocals, TPlatform, TServices>;
  router = createServerRouter({
    routes: options.routes ?? [],
    groups: options.groups,
    middleware: [serverContextMiddleware(), ...(options.middleware ?? [])],
    createLocals: options.createLocals,
    createPlatform: options.createPlatform,
    services: options.services,
    onError: options.onError,
    fallback: context => renderPage(context, options, router, template),
  });
  return request => router.fetch(request);
}
