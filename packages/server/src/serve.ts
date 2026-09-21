import {
  createRouteMatcher,
  validateRoutePattern,
  validateRoutePatterns,
  type RouteTableMatcher,
} from '@memoized-dom/router';
import {
  createApplicationHandler,
  getServerContext,
  type ApplicationHandler,
} from './application-handler';
import type {
  RegisteredServerLocals,
  RegisteredServerPlatform,
  RegisteredServerServices,
  ServerContext,
  ServerHandlerResult,
  ServerMiddleware,
  ServerMiddlewareGroup,
  ServerRoute,
} from './http-router';
import type { ServerComponent } from './index';

type ServerMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

type SegmentParams<TSegment extends string> =
  TSegment extends `:${infer TName}`
    ? { readonly [TKey in TName]: string }
    : TSegment extends '*'
      ? { readonly '*': string }
      : Record<string, never>;

export type ServerRouteParams<TPath extends string> =
  string extends TPath
    ? Readonly<Record<string, string>>
    : TPath extends `${infer THead}/${infer TTail}`
      ? SegmentParams<THead> & ServerRouteParams<TTail>
      : SegmentParams<TPath>;

export type ServerRouteContext<
  TPath extends string,
  TLocals extends object = RegisteredServerLocals,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
> = Omit<ServerContext<TLocals, TPlatform, TServices>, 'params'> & {
  readonly params: Readonly<ServerRouteParams<TPath>>;
};

export type ServerRouteHandler<
  TPath extends string,
  TLocals extends object = RegisteredServerLocals,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
> = (
  context: ServerRouteContext<TPath, TLocals, TPlatform, TServices>,
) => ServerHandlerResult | Promise<ServerHandlerResult>;

export interface ServeOptions<
  TLocals extends object = RegisteredServerLocals,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
> {
  readonly createLocals?: (request: Request) => TLocals;
  readonly createPlatform?: (request: Request) => TPlatform | undefined;
  /** Lazily create application-scoped dependencies once per app instance. */
  readonly createServices?: () => TServices | Promise<TServices>;
  readonly onError?: (
    error: unknown,
    context: ServerContext<TLocals, TPlatform, TServices>,
  ) => Response | Promise<Response>;
}

export interface ServerApplication<
  TLocals extends object = RegisteredServerLocals,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
> {
  fetch(request: Request): Promise<Response>;

  use(...middleware: readonly ServerMiddleware<TLocals, TPlatform, TServices>[]): this;
  use(
    path: string,
    ...middleware: readonly ServerMiddleware<TLocals, TPlatform, TServices>[]
  ): this;

  get<TPath extends string>(
    path: TPath,
    ...pipeline: readonly [
      ...middleware: ServerMiddleware<TLocals, TPlatform, TServices>[],
      handler: ServerRouteHandler<TPath, TLocals, TPlatform, TServices>,
    ]
  ): this;
  post<TPath extends string>(
    path: TPath,
    ...pipeline: readonly [
      ...middleware: ServerMiddleware<TLocals, TPlatform, TServices>[],
      handler: ServerRouteHandler<TPath, TLocals, TPlatform, TServices>,
    ]
  ): this;
  put<TPath extends string>(
    path: TPath,
    ...pipeline: readonly [
      ...middleware: ServerMiddleware<TLocals, TPlatform, TServices>[],
      handler: ServerRouteHandler<TPath, TLocals, TPlatform, TServices>,
    ]
  ): this;
  patch<TPath extends string>(
    path: TPath,
    ...pipeline: readonly [
      ...middleware: ServerMiddleware<TLocals, TPlatform, TServices>[],
      handler: ServerRouteHandler<TPath, TLocals, TPlatform, TServices>,
    ]
  ): this;
  delete<TPath extends string>(
    path: TPath,
    ...pipeline: readonly [
      ...middleware: ServerMiddleware<TLocals, TPlatform, TServices>[],
      handler: ServerRouteHandler<TPath, TLocals, TPlatform, TServices>,
    ]
  ): this;
  head<TPath extends string>(
    path: TPath,
    ...pipeline: readonly [
      ...middleware: ServerMiddleware<TLocals, TPlatform, TServices>[],
      handler: ServerRouteHandler<TPath, TLocals, TPlatform, TServices>,
    ]
  ): this;
  options<TPath extends string>(
    path: TPath,
    ...pipeline: readonly [
      ...middleware: ServerMiddleware<TLocals, TPlatform, TServices>[],
      handler: ServerRouteHandler<TPath, TLocals, TPlatform, TServices>,
    ]
  ): this;

  ssr(component: ServerComponent): this;
  ssr(path: string, component: ServerComponent): this;
}

interface SsrRegistration {
  readonly id: string;
  readonly path: string;
  readonly component: ServerComponent;
}

interface InstallableServerApplication<
  TLocals extends object,
  TPlatform,
  TServices extends object,
> extends ServerApplication<TLocals, TPlatform, TServices> {
  installServerFunctions(
    routes: readonly ServerRoute<TLocals, TPlatform, TServices>[],
  ): void;
  installDocumentTemplate(template: string): void;
}

/**
 * Create one composable Web application. Registration methods validate and
 * retain declarations; the proven router/renderer engine is rebuilt lazily
 * before the next request.
 */
export function serve<
  TLocals extends object = RegisteredServerLocals,
  TPlatform = RegisteredServerPlatform,
  TServices extends object = RegisteredServerServices,
>(
  options: ServeOptions<
    NoInfer<TLocals>,
    NoInfer<TPlatform>,
    NoInfer<TServices>
  > = {},
): ServerApplication<TLocals, TPlatform, TServices> {
  const middleware: ServerMiddleware<TLocals, TPlatform, TServices>[] = [];
  const groups: ServerMiddlewareGroup<TLocals, TPlatform, TServices>[] = [];
  const routes: ServerRoute<TLocals, TPlatform, TServices>[] = [];
  const ssr: SsrRegistration[] = [];
  let fallback: ServerComponent | undefined;
  let ssrMatcher: RouteTableMatcher | undefined;
  let installedServerFunctions: readonly ServerRoute<
    TLocals,
    TPlatform,
    TServices
  >[] = [];
  let documentTemplate: string | undefined;
  let servicesPromise: Promise<TServices> | undefined;
  let current: ApplicationHandler | undefined;
  let dirty = true;

  const invalidate = (): void => {
    dirty = true;
  };

  const rebuildSsrMatcher = (): void => {
    validateRoutePatterns(ssr.map(entry => ({
      id: entry.id,
      pattern: entry.path,
    })));
    ssrMatcher = ssr.length === 0
      ? undefined
      : createRouteMatcher(ssr.map(entry => ({
          id: entry.id,
          pattern: entry.path,
        })));
  };

  const resolveApp = (
    context: ServerContext<TLocals, TPlatform, TServices>,
  ): ServerComponent | undefined => {
    const match = ssrMatcher?.match(context.url.pathname);
    if (match !== null && match !== undefined) {
      return ssr[Number(match.id)]?.component;
    }
    return fallback;
  };

  const resolveServices = async (): Promise<TServices> => {
    if (servicesPromise === undefined) {
      servicesPromise = Promise.resolve().then(() =>
        options.createServices?.() ?? (Object.create(null) as TServices)
      );
    }
    try {
      return await servicesPromise;
    } catch (error) {
      servicesPromise = undefined;
      throw error;
    }
  };

  const handler = async (): Promise<ApplicationHandler> => {
    if (!dirty && current !== undefined) return current;
    const services = await resolveServices();
    current = createApplicationHandler({
      ...(documentTemplate === undefined ? {} : { documentTemplate }),
      ...(fallback === undefined && ssr.length === 0 ? {} : { resolveApp }),
      middleware,
      groups,
      routes: [...installedServerFunctions, ...routes],
      createLocals: options.createLocals,
      createPlatform: options.createPlatform,
      services,
      onError: options.onError,
    });
    dirty = false;
    return current;
  };

  const registerRoute = <TPath extends string>(
    routeMethod: ServerMethod,
    path: TPath,
    pipeline: readonly [
      ...middleware: ServerMiddleware<TLocals, TPlatform, TServices>[],
      handler: ServerRouteHandler<TPath, TLocals, TPlatform, TServices>,
    ],
  ): void => {
    if (pipeline.length === 0) {
      throw new TypeError(
        `memo-dom: ${routeMethod} route '${path}' requires a handler`,
      );
    }
    const routeMiddleware = pipeline.slice(0, -1) as
      ServerMiddleware<TLocals, TPlatform, TServices>[];
    const routeHandler = pipeline[pipeline.length - 1]! as
      ServerRouteHandler<TPath, TLocals, TPlatform, TServices>;
    routes.push({
      method: routeMethod,
      path: validateRoutePattern(path),
      middleware: Object.freeze(routeMiddleware),
      handler: routeHandler as ServerRoute<
        TLocals,
        TPlatform,
        TServices
      >['handler'],
    });
    invalidate();
  };

  const application: InstallableServerApplication<
    TLocals,
    TPlatform,
    TServices
  > = {
    async fetch(request) {
      return (await handler())(request);
    },

    use(
      first: string | ServerMiddleware<TLocals, TPlatform, TServices>,
      ...rest: readonly ServerMiddleware<TLocals, TPlatform, TServices>[]
    ) {
      if (typeof first === 'string') {
        if (rest.length === 0) {
          throw new TypeError(
            `memo-dom: app.use('${first}') requires at least one middleware`,
          );
        }
        groups.push({
          path: validateRoutePattern(first),
          middleware: Object.freeze([...rest]),
        });
      } else {
        middleware.push(first, ...rest);
      }
      invalidate();
      return application;
    },

    get<TPath extends string>(
      path: TPath,
      ...pipeline: readonly [
        ...middleware: ServerMiddleware<TLocals, TPlatform, TServices>[],
        handler: ServerRouteHandler<TPath, TLocals, TPlatform, TServices>,
      ]
    ) {
      registerRoute('GET', path, pipeline);
      return application;
    },

    post<TPath extends string>(path: TPath, ...pipeline: readonly [
      ...middleware: ServerMiddleware<TLocals, TPlatform, TServices>[],
      handler: ServerRouteHandler<TPath, TLocals, TPlatform, TServices>,
    ]) {
      registerRoute('POST', path, pipeline);
      return application;
    },

    put<TPath extends string>(path: TPath, ...pipeline: readonly [
      ...middleware: ServerMiddleware<TLocals, TPlatform, TServices>[],
      handler: ServerRouteHandler<TPath, TLocals, TPlatform, TServices>,
    ]) {
      registerRoute('PUT', path, pipeline);
      return application;
    },

    patch<TPath extends string>(path: TPath, ...pipeline: readonly [
      ...middleware: ServerMiddleware<TLocals, TPlatform, TServices>[],
      handler: ServerRouteHandler<TPath, TLocals, TPlatform, TServices>,
    ]) {
      registerRoute('PATCH', path, pipeline);
      return application;
    },

    delete<TPath extends string>(path: TPath, ...pipeline: readonly [
      ...middleware: ServerMiddleware<TLocals, TPlatform, TServices>[],
      handler: ServerRouteHandler<TPath, TLocals, TPlatform, TServices>,
    ]) {
      registerRoute('DELETE', path, pipeline);
      return application;
    },

    head<TPath extends string>(path: TPath, ...pipeline: readonly [
      ...middleware: ServerMiddleware<TLocals, TPlatform, TServices>[],
      handler: ServerRouteHandler<TPath, TLocals, TPlatform, TServices>,
    ]) {
      registerRoute('HEAD', path, pipeline);
      return application;
    },

    options<TPath extends string>(path: TPath, ...pipeline: readonly [
      ...middleware: ServerMiddleware<TLocals, TPlatform, TServices>[],
      handler: ServerRouteHandler<TPath, TLocals, TPlatform, TServices>,
    ]) {
      registerRoute('OPTIONS', path, pipeline);
      return application;
    },

    ssr(
      pathOrComponent: string | ServerComponent,
      component?: ServerComponent,
    ) {
      if (typeof pathOrComponent === 'function') {
        if (fallback !== undefined) {
          throw new TypeError('memo-dom: app.ssr() fallback is already registered');
        }
        fallback = pathOrComponent;
      } else {
        if (component === undefined) {
          throw new TypeError(
            `memo-dom: app.ssr('${pathOrComponent}') requires a component`,
          );
        }
        const registration: SsrRegistration = {
          id: String(ssr.length),
          path: validateRoutePattern(pathOrComponent),
          component,
        };
        ssr.push(registration);
        try {
          rebuildSsrMatcher();
        } catch (error) {
          ssr.pop();
          rebuildSsrMatcher();
          throw error;
        }
      }
      invalidate();
      return application;
    },

    installServerFunctions(next) {
      if (next === installedServerFunctions) return;
      installedServerFunctions = next;
      invalidate();
    },

    installDocumentTemplate(next) {
      if (next === documentTemplate) return;
      documentTemplate = next;
      invalidate();
    },
  };

  return application;
}

export { getServerContext };
