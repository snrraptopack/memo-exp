import {
  createRouteMatcher,
  matchRoutePattern,
  normalizeRoutePath,
  validateRoutePattern,
  validateRoutePatterns,
  type RouteTableMatcher,
} from '@memoized-dom/router';

export type ServerHandlerResult = unknown;

export interface ServerContext<
  TLocals extends object = Record<string, never>,
  TPlatform = unknown,
> {
  readonly request: Request;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly locals: TLocals;
  readonly platform: TPlatform | undefined;
}

export type ServerHandler<
  TLocals extends object = Record<string, never>,
  TPlatform = unknown,
> = (
  context: ServerContext<TLocals, TPlatform>,
) => ServerHandlerResult | Promise<ServerHandlerResult>;

export type ServerMiddleware<
  TLocals extends object = Record<string, never>,
  TPlatform = unknown,
> = (
  context: ServerContext<TLocals, TPlatform>,
  next: () => Promise<Response>,
) => Response | Promise<Response>;

export interface ServerRoute<
  TLocals extends object = Record<string, never>,
  TPlatform = unknown,
> {
  readonly id?: string;
  readonly method: string | readonly string[];
  readonly path: string;
  readonly middleware?: readonly ServerMiddleware<TLocals, TPlatform>[];
  readonly handler: ServerHandler<TLocals, TPlatform>;
}

export type ServerFunctionQueryKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]'
  | 'boolean[]';

export interface ServerFunctionRouteParameter {
  readonly name: string;
  readonly optional: boolean;
  readonly queryKind?: ServerFunctionQueryKind;
}

export interface ServerFunctionRouteDefinition<
  TLocals extends object = Record<string, never>,
  TPlatform = unknown,
> {
  readonly id: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: `/_fn/${string}`;
  readonly parameters: readonly ServerFunctionRouteParameter[];
  readonly middleware?: readonly ServerMiddleware<TLocals, TPlatform>[];
  readonly handler: (...args: unknown[]) => ServerHandlerResult | Promise<ServerHandlerResult>;
}

export interface ServerMiddlewareGroup<
  TLocals extends object = Record<string, never>,
  TPlatform = unknown,
> {
  readonly path: string;
  readonly middleware: readonly ServerMiddleware<TLocals, TPlatform>[];
}

export interface ServerDispatchOptions<
  TLocals extends object = Record<string, never>,
  TPlatform = unknown,
> {
  /** Reuse request-owned locals for a derived in-memory dispatch. */
  readonly locals?: TLocals;
  readonly platform?: TPlatform;
}

export interface ServerRouterOptions<
  TLocals extends object = Record<string, never>,
  TPlatform = unknown,
> {
  readonly routes: readonly ServerRoute<TLocals, TPlatform>[];
  readonly middleware?: readonly ServerMiddleware<TLocals, TPlatform>[];
  readonly groups?: readonly ServerMiddlewareGroup<TLocals, TPlatform>[];
  readonly createLocals?: (request: Request) => TLocals;
  readonly createPlatform?: (request: Request) => TPlatform | undefined;
  /** Handles paths that have no HTTP route. A future defineServer uses this for pages. */
  readonly fallback?: ServerHandler<TLocals, TPlatform>;
  readonly onError?: (
    error: unknown,
    context: ServerContext<TLocals, TPlatform>,
  ) => Response | Promise<Response>;
}

export interface ServerRouter<
  TLocals extends object = Record<string, never>,
  TPlatform = unknown,
> {
  readonly fetch: (request: Request) => Promise<Response>;
  dispatch(
    request: Request,
    options?: ServerDispatchOptions<TLocals, TPlatform>,
  ): Promise<Response>;
  matches(pathname: string, method: string): boolean;
  allowedMethods(pathname: string): readonly string[];
}

interface PreparedRoute<TLocals extends object, TPlatform> {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly middleware: readonly ServerMiddleware<TLocals, TPlatform>[];
  readonly handler: ServerHandler<TLocals, TPlatform>;
}

interface PreparedGroup<TLocals extends object, TPlatform> {
  readonly path: string;
  readonly depth: number;
  readonly order: number;
  readonly middleware: readonly ServerMiddleware<TLocals, TPlatform>[];
}

interface RouteSelection<TLocals extends object, TPlatform> {
  readonly route: PreparedRoute<TLocals, TPlatform>;
  readonly params: Readonly<Record<string, string>>;
}

interface MethodMatch<TLocals extends object, TPlatform> {
  readonly route: PreparedRoute<TLocals, TPlatform>;
  readonly params: Readonly<Record<string, string>>;
}

const METHOD_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Z-]+$/;
const EMPTY_PARAMS: Readonly<Record<string, string>> = Object.freeze(
  Object.create(null) as Record<string, string>,
);
const DEFAULT_METHOD_ORDER = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
];
/**
 * String-keyed brand: route objects cross module instances (dev-server vs
 * host), where a Symbol identity would not match.
 */
const SERVER_FUNCTION_ROUTE_KEY = '__memoDomServerFunctionRoute';

type InternalServerFunctionRoute<TLocals extends object, TPlatform> =
  ServerRoute<TLocals, TPlatform> & {
    readonly [SERVER_FUNCTION_ROUTE_KEY]?: true;
  };

class ServerFunctionInputError extends Error {}

function serverFunctionInputError(message: string): never {
  throw new ServerFunctionInputError(message);
}

function scalarQueryValue(
  name: string,
  value: string,
  kind: 'string' | 'number' | 'boolean',
): string | number | boolean {
  if (kind === 'string') return value;
  if (kind === 'number') {
    const number = Number(value);
    if (value.trim() === '' || !Number.isFinite(number)) {
      return serverFunctionInputError(
        `Query parameter '${name}' must be a finite number`,
      );
    }
    return number;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return serverFunctionInputError(
    `Query parameter '${name}' must be 'true' or 'false'`,
  );
}

function queryArguments(
  url: URL,
  parameters: readonly ServerFunctionRouteParameter[],
): unknown[] {
  const known = new Set(parameters.map(parameter => parameter.name));
  for (const name of url.searchParams.keys()) {
    if (!known.has(name)) {
      serverFunctionInputError(`Unknown query parameter '${name}'`);
    }
  }
  return parameters.map((parameter) => {
    const kind = parameter.queryKind ?? 'string';
    const values = url.searchParams.getAll(parameter.name);
    if (values.length === 0) {
      if (parameter.optional) return undefined;
      return serverFunctionInputError(
        `Missing query parameter '${parameter.name}'`,
      );
    }
    if (kind.endsWith('[]')) {
      const scalarKind = kind.slice(0, -2) as 'string' | 'number' | 'boolean';
      return values.map(value =>
        scalarQueryValue(parameter.name, value, scalarKind));
    }
    if (values.length !== 1) {
      return serverFunctionInputError(
        `Query parameter '${parameter.name}' must appear once`,
      );
    }
    return scalarQueryValue(
      parameter.name,
      values[0]!,
      kind as 'string' | 'number' | 'boolean',
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function bodyArguments(
  request: Request,
  parameters: readonly ServerFunctionRouteParameter[],
): Promise<unknown[]> {
  if (parameters.length === 0 && request.body === null) return [];
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return serverFunctionInputError('Request body must be valid JSON');
  }
  if (!isRecord(body)) {
    return serverFunctionInputError('Request body must be a JSON object');
  }
  const known = new Set(parameters.map(parameter => parameter.name));
  for (const name of Object.keys(body)) {
    if (!known.has(name)) {
      serverFunctionInputError(`Unknown request body field '${name}'`);
    }
  }
  return parameters.map((parameter) => {
    if (!(parameter.name in body)) {
      if (parameter.optional) return undefined;
      return serverFunctionInputError(
        `Missing request body field '${parameter.name}'`,
      );
    }
    return body[parameter.name];
  });
}

function serverFunctionError(error: ServerFunctionInputError): Response {
  return Response.json({
    error: 'invalid_server_function_input',
    message: error.message,
  }, { status: 400 });
}

/** Convert discovered named HTTP functions into ordinary router definitions. */
export function createServerFunctionRoutes<
  TLocals extends object = Record<string, never>,
  TPlatform = unknown,
>(
  definitions: readonly ServerFunctionRouteDefinition<TLocals, TPlatform>[],
): readonly ServerRoute<TLocals, TPlatform>[] {
  return definitions.map((definition) => {
    if (!definition.path.startsWith('/_fn/')) {
      throw new TypeError(
        `Server function '${definition.id}' must use the reserved /_fn/ namespace`,
      );
    }
    const route: InternalServerFunctionRoute<TLocals, TPlatform> = {
      [SERVER_FUNCTION_ROUTE_KEY]: true,
      id: definition.id,
      method: definition.method,
      path: definition.path,
      middleware: definition.middleware,
      async handler(context) {
        try {
          const args = definition.method === 'GET'
            ? queryArguments(context.url, definition.parameters)
            : await bodyArguments(context.request, definition.parameters);
          return definition.handler(...args);
        } catch (error) {
          if (error instanceof ServerFunctionInputError) {
            return serverFunctionError(error);
          }
          throw error;
        }
      },
    };
    return Object.freeze(route);
  });
}

function normalizeMethod(method: string): string {
  const normalized = method.toUpperCase();
  if (normalized === '' || !METHOD_TOKEN.test(normalized)) {
    throw new TypeError(`Invalid HTTP method '${method}'`);
  }
  return normalized;
}

function methodsFor(route: {
  readonly method: string | readonly string[];
  readonly path: string;
}): readonly string[] {
  const methods = typeof route.method === 'string'
    ? [route.method]
    : route.method;
  if (methods.length === 0) {
    throw new TypeError(`Route '${route.path}' must declare at least one HTTP method`);
  }
  return Object.freeze([...new Set(methods.map(normalizeMethod))]);
}

function textResponse(value: string): Response {
  return new Response(value, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function normalizeHandlerResult(value: unknown): Response {
  if (value instanceof Response) return value;
  if (value === undefined) return new Response(null, { status: 204 });
  if (typeof value === 'string') return textResponse(value);
  if (value instanceof ReadableStream) return new Response(value);
  return Response.json(value);
}

async function runMiddleware<TLocals extends object, TPlatform>(
  middleware: readonly ServerMiddleware<TLocals, TPlatform>[],
  terminal: (context: ServerContext<TLocals, TPlatform>) => Promise<Response>,
  context: ServerContext<TLocals, TPlatform>,
): Promise<Response> {
  let activeIndex = -1;
  const run = async (index: number): Promise<Response> => {
    if (index <= activeIndex) {
      throw new Error('Server middleware called next() more than once');
    }
    activeIndex = index;
    const current = middleware[index];
    if (current === undefined) return terminal(context);
    return current(context, () => run(index + 1));
  };
  return run(0);
}

function methodRank(method: string): number {
  const index = DEFAULT_METHOD_ORDER.indexOf(method);
  return index === -1 ? DEFAULT_METHOD_ORDER.length : index;
}

function sortMethods(left: string, right: string): number {
  const rank = methodRank(left) - methodRank(right);
  return rank === 0 ? left.localeCompare(right) : rank;
}

function withoutBody(response: Response): Response {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Create a portable method-aware HTTP dispatcher over Web Request/Response.
 * Rendering and filesystem discovery deliberately live above this layer.
 */
export function createServerRouter<
  TLocals extends object = Record<string, never>,
  TPlatform = unknown,
>(
  options: ServerRouterOptions<TLocals, TPlatform>,
): ServerRouter<TLocals, TPlatform> {
  const routesByMethod = new Map<string, PreparedRoute<TLocals, TPlatform>[]>();
  const routesById = new Map<string, PreparedRoute<TLocals, TPlatform>>();

  for (let routeIndex = 0; routeIndex < options.routes.length; routeIndex++) {
    const declared = options.routes[routeIndex]!;
    const path = validateRoutePattern(declared.path);
    const internal = declared as InternalServerFunctionRoute<TLocals, TPlatform>;
    if (
      (path === '/_fn' || path.startsWith('/_fn/')) &&
      internal[SERVER_FUNCTION_ROUTE_KEY] !== true
    ) {
      throw new TypeError(
        `Route '${path}' uses the reserved server-function namespace '/_fn/*'`,
      );
    }
    const routeMethods = methodsFor(declared);
    for (const method of routeMethods) {
      const id = `${routeIndex}:${method}:${declared.id ?? path}`;
      const route: PreparedRoute<TLocals, TPlatform> = Object.freeze({
        id,
        method,
        path,
        middleware: Object.freeze([...(declared.middleware ?? [])]),
        handler: declared.handler,
      });
      let methodRoutes = routesByMethod.get(method);
      if (methodRoutes === undefined) {
        methodRoutes = [];
        routesByMethod.set(method, methodRoutes);
      }
      methodRoutes.push(route);
      routesById.set(id, route);
    }
  }

  const staticRoutes = new Map<string, Map<string, PreparedRoute<TLocals, TPlatform>>>();
  const dynamicMatchers = new Map<string, RouteTableMatcher>();
  for (const [method, routes] of routesByMethod) {
    const definitions = routes.map(route => ({
      id: route.id,
      pattern: route.path,
    }));
    try {
      validateRoutePatterns(definitions);
    } catch (error) {
      throw new TypeError(`Invalid ${method} route table`, { cause: error });
    }
    const staticMethodRoutes = new Map<string, PreparedRoute<TLocals, TPlatform>>();
    const dynamicDefinitions: typeof definitions = [];
    for (let index = 0; index < routes.length; index++) {
      const route = routes[index]!;
      if (route.path.includes(':') || route.path.includes('*')) {
        dynamicDefinitions.push(definitions[index]!);
      } else {
        staticMethodRoutes.set(route.path, route);
      }
    }
    if (staticMethodRoutes.size > 0) staticRoutes.set(method, staticMethodRoutes);
    if (dynamicDefinitions.length > 0) {
      dynamicMatchers.set(method, createRouteMatcher(dynamicDefinitions));
    }
  }

  const groups: readonly PreparedGroup<TLocals, TPlatform>[] = Object.freeze(
    (options.groups ?? [])
      .map((group, order) => {
        const path = validateRoutePattern(group.path);
        return Object.freeze({
          path,
          depth: path === '/' ? 0 : path.split('/').length - 1,
          order,
          middleware: Object.freeze([...group.middleware]),
        });
      })
      .sort((left, right) => left.depth - right.depth || left.order - right.order),
  );
  const globalMiddleware = Object.freeze([...(options.middleware ?? [])]);

  function matchMethod(
    pathname: string,
    method: string,
  ): MethodMatch<TLocals, TPlatform> | null {
    const staticRoute = staticRoutes.get(method)?.get(pathname);
    if (staticRoute !== undefined) {
      return { route: staticRoute, params: EMPTY_PARAMS };
    }
    const dynamic = dynamicMatchers.get(method)?.match(pathname) ?? null;
    return dynamic === null
      ? null
      : { route: routesById.get(dynamic.id)!, params: dynamic.params };
  }

  function select(pathname: string, method: string): RouteSelection<TLocals, TPlatform> | null {
    const normalizedMethod = normalizeMethod(method);
    const direct = matchMethod(pathname, normalizedMethod);
    if (direct !== null) {
      return {
        route: direct.route,
        params: direct.params,
      };
    }
    if (normalizedMethod !== 'HEAD') return null;
    const get = matchMethod(pathname, 'GET');
    return get === null
      ? null
      : {
          route: get.route,
          params: get.params,
        };
  }

  function allowedMethods(pathname: string): readonly string[] {
    const allowed = new Set<string>();
    for (const method of routesByMethod.keys()) {
      if (matchMethod(pathname, method) === null) continue;
      allowed.add(method);
      if (method === 'GET') allowed.add('HEAD');
    }
    if (allowed.size > 0) allowed.add('OPTIONS');
    return Object.freeze([...allowed].sort(sortMethods));
  }

  function matchingGroups(
    pathname: string,
  ): {
    readonly middleware: readonly ServerMiddleware<TLocals, TPlatform>[];
    readonly params: Readonly<Record<string, string>>;
  } {
    if (groups.length === 0) {
      return { middleware: globalMiddleware, params: EMPTY_PARAMS };
    }
    const middleware = [...globalMiddleware];
    const params: Record<string, string> = {};
    for (const group of groups) {
      const match = matchRoutePattern(group.path, pathname, { end: false });
      if (match === null) continue;
      middleware.push(...group.middleware);
      for (const [name, value] of Object.entries(match.params)) {
        if (name !== '*') params[name] = value;
      }
    }
    return {
      middleware,
      params: Object.keys(params).length === 0
        ? EMPTY_PARAMS
        : Object.freeze(params),
    };
  }

  async function dispatch(
    request: Request,
    dispatchOptions: ServerDispatchOptions<TLocals, TPlatform> = {},
  ): Promise<Response> {
    const url = new URL(request.url);
    const pathname = normalizeRoutePath(url.pathname);
    const method = normalizeMethod(request.method);
    const selection = select(pathname, method);
    const allowed = selection === null ? allowedMethods(pathname) : [];
    const groupMatch = matchingGroups(pathname);
    const params = selection === null
      ? groupMatch.params
      : Object.freeze({ ...groupMatch.params, ...selection.params });
    const locals = dispatchOptions.locals ?? options.createLocals?.(request) ??
      (Object.create(null) as TLocals);
    const platform = dispatchOptions.platform ?? options.createPlatform?.(request);
    const context: ServerContext<TLocals, TPlatform> = Object.freeze({
      request,
      url,
      params,
      locals,
      platform,
    });

    let terminal: (value: ServerContext<TLocals, TPlatform>) => Promise<Response>;
    let middleware = groupMatch.middleware;
    if (selection !== null) {
      middleware = [...middleware, ...selection.route.middleware];
      terminal = async value => {
        return normalizeHandlerResult(
          await selection.route.handler(value),
        );
      };
    } else if (method === 'OPTIONS' && allowed.length > 0) {
      terminal = async () => new Response(null, {
        status: 204,
        headers: { allow: allowed.join(', ') },
      });
    } else if (allowed.length > 0) {
      terminal = async () => new Response('Method Not Allowed', {
        status: 405,
        headers: { allow: allowed.join(', ') },
      });
    } else if (options.fallback !== undefined) {
      terminal = async value => normalizeHandlerResult(await options.fallback!(value));
    } else {
      terminal = async () => new Response('Not Found', { status: 404 });
    }

    try {
      const response = await runMiddleware(middleware, terminal, context);
      return method === 'HEAD' ? withoutBody(response) : response;
    } catch (error) {
      const response = options.onError === undefined
        ? new Response('Internal Server Error', { status: 500 })
        : await options.onError(error, context);
      return method === 'HEAD' ? withoutBody(response) : response;
    }
  }

  return Object.freeze({
    fetch: (request: Request) => dispatch(request),
    dispatch,
    matches(pathname: string, method: string) {
      return select(normalizeRoutePath(pathname), method) !== null;
    },
    allowedMethods(pathname: string) {
      return allowedMethods(normalizeRoutePath(pathname));
    },
  });
}
