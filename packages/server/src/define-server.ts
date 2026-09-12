/**
 * The optional application-server composition layer.
 *
 * `defineServer` combines the router, page renderer, generated
 * server-function routes, middleware, and same-origin in-memory `$fetch`
 * bridge. The lower-level primitives remain public for custom hosts.
 */
import { createStorage } from '@memoized-dom/runtime/server';
import {
  createServerRouter,
  type ServerContext,
  type ServerHandler,
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

export interface DefineServerRenderPolicy {
  /** Resolve request data before output, or emit the immediate pending shell. */
  readonly mode?: RenderOptions['mode'];
  /** Emit hydration anchors and the serialized data payload. */
  readonly markers?: boolean;
  /** Resolve-mode quiescence budget in milliseconds. */
  readonly timeout?: number;
  /** Stream the ordered document or buffer it before returning. */
  readonly delivery?: 'stream' | 'buffer';
}

export type DefineServerMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

export type DefineServerMethodValue<TLocals extends object, TPlatform> =
  | ServerHandler<TLocals, TPlatform>
  | {
      readonly middleware?: readonly ServerMiddleware<TLocals, TPlatform>[];
      readonly handler: ServerHandler<TLocals, TPlatform>;
    };

/**
 * A bare handler is GET. An object can be an implicit GET handler, an HTTP
 * method map, or a middleware-only prefix group.
 */
export type DefineServerRouteValue<TLocals extends object, TPlatform> =
  | ServerHandler<TLocals, TPlatform>
  | {
      readonly middleware?: readonly ServerMiddleware<TLocals, TPlatform>[];
      readonly handler?: ServerHandler<TLocals, TPlatform>;
      readonly GET?: DefineServerMethodValue<TLocals, TPlatform>;
      readonly POST?: DefineServerMethodValue<TLocals, TPlatform>;
      readonly PUT?: DefineServerMethodValue<TLocals, TPlatform>;
      readonly PATCH?: DefineServerMethodValue<TLocals, TPlatform>;
      readonly DELETE?: DefineServerMethodValue<TLocals, TPlatform>;
      readonly HEAD?: DefineServerMethodValue<TLocals, TPlatform>;
      readonly OPTIONS?: DefineServerMethodValue<TLocals, TPlatform>;
    };

export interface DefineServerOptions<
  TLocals extends object = Record<string, never>,
  TPlatform = unknown,
> {
  readonly app?: ServerComponent;
  /** Filesystem template path. Loaded and validated once when defined. */
  readonly document?: string | URL;
  /** Preloaded template content for hosts that do not expose a filesystem. */
  readonly documentTemplate?: string;
  readonly middleware?: readonly ServerMiddleware<TLocals, TPlatform>[];
  readonly routes?: Readonly<
    Record<string, DefineServerRouteValue<TLocals, TPlatform>>
  >;
  /** Generated routes from `virtual:memoized-dom/server-functions`. */
  readonly serverFunctions?: readonly ServerRoute<TLocals, TPlatform>[];
  readonly render?: DefineServerRenderPolicy;
  readonly init?: ResponseInit;
  readonly createLocals?: (request: Request) => TLocals;
  readonly createPlatform?: (request: Request) => TPlatform | undefined;
  readonly fetch?: typeof globalThis.fetch;
  readonly onError?: (
    error: unknown,
    context: ServerContext<TLocals, TPlatform>,
  ) => Response | Promise<Response>;
}

export interface DefineServerHandler<
  TLocals extends object = Record<string, never>,
  TPlatform = unknown,
> {
  (request: Request): Promise<Response>;
  /** Adapter hook used to install a freshly generated server-function table. */
  installServerFunctions(
    routes: readonly ServerRoute<TLocals, TPlatform>[],
  ): void;
}

interface NormalizedRoutes<TLocals extends object, TPlatform> {
  readonly routes: readonly ServerRoute<TLocals, TPlatform>[];
  readonly groups: readonly ServerMiddlewareGroup<TLocals, TPlatform>[];
}

interface ActiveServerContext {
  readonly context: ServerContext<object, unknown>;
  readonly dispatchDepth: number;
}

const activeServerContext = createStorage<ActiveServerContext>(
  'memoized-dom:server-context',
);
const METHODS: readonly DefineServerMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];
const MAX_DISPATCH_DEPTH = 8;
const DEFAULT_TIMEOUT = 10_000;

/** Read the request context from middleware or a server-function body. */
export function getServerContext<
  TLocals extends object = Record<string, never>,
  TPlatform = unknown,
>(): ServerContext<TLocals, TPlatform> {
  const active = activeServerContext.getStore();
  if (active === undefined) {
    throw new Error(
      'memo-dom: getServerContext() must be called while defineServer is handling a request',
    );
  }
  return active.context as unknown as ServerContext<TLocals, TPlatform>;
}

function normalizeRouteEntry<TLocals extends object, TPlatform>(
  path: string,
  value: DefineServerRouteValue<TLocals, TPlatform>,
  routes: ServerRoute<TLocals, TPlatform>[],
  groups: ServerMiddlewareGroup<TLocals, TPlatform>[],
): void {
  if (typeof value === 'function') {
    routes.push({ method: 'GET', path, handler: value });
    return;
  }

  let hasMethod = false;
  for (const method of METHODS) {
    const entry = value[method];
    if (entry === undefined) continue;
    hasMethod = true;
    routes.push(
      typeof entry === 'function'
        ? {
            method,
            path,
            middleware: value.middleware,
            handler: entry,
          }
        : {
            method,
            path,
            middleware:
              value.middleware === undefined
                ? entry.middleware
                : [...value.middleware, ...(entry.middleware ?? [])],
            handler: entry.handler,
          },
    );
  }
  if (hasMethod) {
    if (value.handler !== undefined) {
      throw new TypeError(
        `memo-dom: route '${path}' cannot combine an implicit GET handler with explicit HTTP methods`,
      );
    }
    return;
  }

  if (value.handler !== undefined) {
    routes.push({
      method: 'GET',
      path,
      middleware: value.middleware,
      handler: value.handler,
    });
    return;
  }
  if (value.middleware !== undefined) {
    groups.push({ path, middleware: value.middleware });
    return;
  }
  throw new TypeError(
    `memo-dom: route '${path}' declares no handler or middleware`,
  );
}

function normalizeRoutes<TLocals extends object, TPlatform>(
  options: DefineServerOptions<TLocals, TPlatform>,
  serverFunctions: readonly ServerRoute<TLocals, TPlatform>[],
): NormalizedRoutes<TLocals, TPlatform> {
  const routes: ServerRoute<TLocals, TPlatform>[] = [
    ...serverFunctions,
  ];
  const groups: ServerMiddlewareGroup<TLocals, TPlatform>[] = [];
  for (const [path, value] of Object.entries(options.routes ?? {})) {
    normalizeRouteEntry(path, value, routes, groups);
  }
  return { routes, groups };
}

function prepareDocument<TLocals extends object, TPlatform>(
  options: DefineServerOptions<TLocals, TPlatform>,
): DocumentTemplate | undefined {
  if (options.document !== undefined && options.documentTemplate !== undefined) {
    throw new TypeError(
      'memo-dom: defineServer accepts either `document` or `documentTemplate`, not both',
    );
  }
  const template = options.documentTemplate !== undefined
    ? splitDocumentTemplate(options.documentTemplate)
    : options.document !== undefined
      ? loadDocumentTemplate(options.document)
      : undefined;
  if (options.app !== undefined && template === undefined) {
    throw new TypeError(
      'memo-dom: defineServer requires `document` or `documentTemplate` when `app` is configured',
    );
  }
  return template;
}

function serverContextMiddleware<TLocals extends object, TPlatform>():
ServerMiddleware<TLocals, TPlatform> {
  return (context, next) => {
    const inheritedDepth = activeServerContext.getStore()?.dispatchDepth ?? 0;
    return activeServerContext.run(
      {
        context: context as unknown as ServerContext<object, unknown>,
        dispatchDepth: inheritedDepth,
      },
      next,
    );
  };
}

function createServerFetch<TLocals extends object, TPlatform>(
  router: ServerRouter<TLocals, TPlatform>,
  parent: ServerContext<TLocals, TPlatform>,
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
        context: (current?.context ?? parent) as unknown as ServerContext<object, unknown>,
        dispatchDepth,
      },
      () => router.dispatch(request, {
        locals: parent.locals,
        ...(parent.platform === undefined ? {} : { platform: parent.platform }),
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

function renderOptions<TLocals extends object, TPlatform>(
  context: ServerContext<TLocals, TPlatform>,
  options: DefineServerOptions<TLocals, TPlatform>,
  router: ServerRouter<TLocals, TPlatform>,
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

async function renderPage<TLocals extends object, TPlatform>(
  context: ServerContext<TLocals, TPlatform>,
  options: DefineServerOptions<TLocals, TPlatform>,
  router: ServerRouter<TLocals, TPlatform>,
  template: DocumentTemplate | undefined,
): Promise<Response> {
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }
  if (options.app === undefined || template === undefined) {
    return new Response('Not Found', { status: 404 });
  }

  const render = renderOptions(context, options, router);
  if ((options.render?.delivery ?? 'stream') === 'buffer') {
    const application = render.markers
      ? await renderToResultAsync(options.app, render).then(
          result => result.html + result.scriptTag,
        )
      : await renderToStringAsync(options.app, render);
    return htmlResponse(template.prefix + application + template.suffix, options.init);
  }

  const application = prepareRenderToReadableStream(options.app, {
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

/** Compose a standard Web handler suitable for Bun, Node adapters, or Vite. */
export function defineServer<
  TLocals extends object = Record<string, never>,
  TPlatform = unknown,
>(options: DefineServerOptions<TLocals, TPlatform>):
DefineServerHandler<TLocals, TPlatform> {
  const template = prepareDocument(options);
  const configuredServerFunctions = options.serverFunctions ?? [];
  let installedServerFunctions: readonly ServerRoute<TLocals, TPlatform>[] = [];

  const createRouter = (): ServerRouter<TLocals, TPlatform> => {
    const normalized = normalizeRoutes(options, [
      ...configuredServerFunctions,
      ...installedServerFunctions.filter(
        route => !configuredServerFunctions.includes(route),
      ),
    ]);
    let created: ServerRouter<TLocals, TPlatform>;
    created = createServerRouter({
      routes: normalized.routes,
      groups: normalized.groups,
      middleware: [serverContextMiddleware(), ...(options.middleware ?? [])],
      createLocals: options.createLocals,
      createPlatform: options.createPlatform,
      onError: options.onError,
      fallback: context => renderPage(context, options, created, template),
    });
    return created;
  };

  let router = createRouter();
  const handler = ((request: Request) => router.fetch(request)) as
    DefineServerHandler<TLocals, TPlatform>;
  handler.installServerFunctions = (routes) => {
    if (routes === installedServerFunctions) return;
    installedServerFunctions = routes;
    router = createRouter();
  };
  return handler;
}
