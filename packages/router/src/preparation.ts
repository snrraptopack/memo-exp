import type { RouteRuntime } from './runtime';
import { getActiveRouteRuntime } from './active-runtime';
import {installRoutePreparationRunner, installRouteModuleLoader, prepareRoutedMatches,
  type RoutePreparationTransaction} from './preparation-capability';
import {prepareRouteModules} from './route-modules';
import {awaitRouteWork} from './route-work';
export {prepareRoutedMatches} from './preparation-capability';
export {readRouteModuleState, subscribeRouteModuleState, registerRouteComponent,
  readRouteComponent, prepareInitialRouteModules} from './route-modules';
export type {RouteModuleState, RouteModuleListener} from './route-modules';
import type {
  RouteMatch,
  RouteQuery,
  RouteRedirect,
  RoutedCacheState,
  RoutedContext,
  RoutedPreparation,
} from './types';

const ROUTED_ENDPOINT = '/_memoized/routed';

export interface RoutedPreparationDefinition {
  readonly id: string;
  readonly server: boolean;
  readonly prepare?: RoutedPreparation<
    unknown,
    Readonly<Record<string, string>>,
    object,
    unknown,
    object
  >;
  readonly settle?: (
    value: unknown,
    signal: AbortSignal,
  ) => Promise<unknown> | undefined;
}

export interface RoutedPreparationMetadata {
  readonly preparations?: readonly string[];
  readonly componentKey?: string;
  readonly moduleLoader?: () => Promise<unknown>;
}

export interface RoutedPreparationInput {
  readonly href: string;
  readonly params: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly serverContext?: RoutedServerContext;
  /** Initial client entry may reuse values delivered by SSR, unlike navigation. */
  readonly reusePrepared?: boolean;
}

export interface RoutedServerContext {
  readonly request: Request;
  readonly locals: object;
  readonly platform?: unknown;
  readonly services: object;
}

export type RoutedPreparationOutcome =
  | {
      readonly kind: 'data';
      readonly data: unknown;
      readonly state?: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: 'redirect'; readonly redirect: RouteRedirect };

export interface SerializedRoutedPreparationState {
  readonly version: 1;
  readonly entries: readonly {
    readonly id: string;
    readonly data: unknown;
    readonly state: Readonly<Record<string, unknown>>;
  }[];
}

export class RoutedPreparationRedirectError extends Error {
  override readonly name = 'RoutedPreparationRedirectError';

  constructor(readonly redirect: RouteRedirect) {
    super(`Route preparation redirected to '${redirect.to.toString()}'`);
  }
}

const definitions = new Map<string, RoutedPreparationDefinition>();
const preparedByRuntime = new WeakMap<RouteRuntime, Map<string, unknown>>();
const cacheStateByRuntime = new WeakMap<
  RouteRuntime,
  Map<string, RoutedCacheState>
>();

function preparationKey(routeId: string, id: string): string {
  return JSON.stringify([routeId, id]);
}

function preparationIds(matches: readonly RouteMatch[]): Array<{ id: string; key: string }> {
  const ids: Array<{ id: string; key: string }> = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const metadata = match.metadata as RoutedPreparationMetadata | undefined;
    for (const id of metadata?.preparations ?? []) {
      const key = preparationKey(match.id, id);
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push({ id, key });
    }
  }
  return ids;
}

function routeQuery(url: URL): RouteQuery {
  return Object.freeze(new URLSearchParams(url.search)) as RouteQuery;
}

function isRedirect(value: unknown): value is RouteRedirect {
  return typeof value === 'object' && value !== null && 'to' in value;
}

function stateFor(runtime: RouteRuntime, id: string): RoutedCacheState {
  let states = cacheStateByRuntime.get(runtime);
  if (states === undefined) {
    states = new Map();
    cacheStateByRuntime.set(runtime, states);
  }
  let state = states.get(id);
  if (state === undefined) {
    state = {};
    states.set(id, state);
  }
  return state;
}

function browserContext(
  runtime: RouteRuntime,
  id: string,
  input: RoutedPreparationInput,
): RoutedContext<Readonly<Record<string, string>>, object, unknown, object> {
  const url = new URL(input.href);
  const server = input.serverContext;
  return Object.freeze({
    state: stateFor(runtime, id),
    params: input.params,
    url,
    query: routeQuery(url),
    request: server?.request ?? new Request(url, { signal: input.signal }),
    locals: server?.locals ?? Object.freeze({}),
    platform: server?.platform,
    services: server?.services ?? Object.freeze({}),
    signal: input.signal,
  });
}

async function invokeBrowserServerPreparation(
  runtime: RouteRuntime,
  id: string,
  key: string,
  input: RoutedPreparationInput,
): Promise<RoutedPreparationOutcome> {
  const response = await fetch(ROUTED_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id,
      href: input.href,
      params: input.params,
      state: transportState(stateFor(runtime, key)),
    }),
    signal: input.signal,
  });
  if (!response.ok) {
    throw new Error(
      `memo-dom: route preparation '${id}' failed with ${response.status}`,
    );
  }
  return await response.json() as RoutedPreparationOutcome;
}

/** Compiler-runtime registration. A repeated ID replaces its HMR predecessor. */
export function registerRoutedPreparation(
  definition: RoutedPreparationDefinition,
): void {
  if (definition.id.trim() === '') {
    throw new TypeError('memo-dom: routed preparation IDs must not be empty');
  }
  definitions.set(definition.id, Object.freeze({ ...definition }));
}

export { hasRoutedPreparations } from './preparation-capability';

/** One transaction publishes all matched gate values only after every gate succeeds. */
export function createRoutePreparationTransaction(
  runtime: RouteRuntime,
  input: RoutedPreparationInput,
): RoutePreparationTransaction {
  const pending = new Map<string, unknown>();
  return {
    async prepare(match) {
      for (const { id, key } of preparationIds([match])) {
        input.signal.throwIfAborted();
        if (input.reusePrepared && preparedByRuntime.get(runtime)?.has(key)) continue;
        const definition = definitions.get(id);
        if (definition === undefined) {
          throw new Error(`memo-dom: missing routed preparation '${id}'`);
        }
        if (
          definition.server &&
          input.serverContext === undefined &&
          definition.prepare !== undefined
        ) {
          throw new Error(
            `memo-dom: server routed preparation '${id}' requires an active server request context`,
          );
        }
        const outcome: RoutedPreparationOutcome = await awaitRouteWork(
          definition.prepare === undefined
          ? invokeBrowserServerPreparation(runtime, id, key, input)
          : (async () => {
              const value = await definition.prepare!(browserContext(runtime, key, input));
              return definition.settle?.(value, input.signal) ?? value;
            })().then(data => isRedirect(data)
              ? { kind: 'redirect', redirect: data } as const
              : { kind: 'data', data } as const),
          input.signal,
        );
        if (outcome.kind === 'redirect') return outcome;
        if (outcome.state !== undefined) {
          Object.assign(stateFor(runtime, key), outcome.state);
        }
        pending.set(key, outcome.data);
      }
      return undefined;
    },
    commit() {
      // The application's callback may ignore cancellation. Never let its late
      // result overwrite data belonging to a newer navigation, even at the last
      // gate where there is no subsequent child to check the signal.
      input.signal.throwIfAborted();
      let prepared = preparedByRuntime.get(runtime);
      if (prepared === undefined) {
        prepared = new Map();
        preparedByRuntime.set(runtime, prepared);
      }
      for (const [id, value] of pending) prepared.set(id, value);
    },
  };
}

export interface InitialRoutedPreparationOptions {
  readonly serverContext?: RoutedServerContext;
  /** Initial client entry may reuse values delivered by SSR. */
  readonly reusePrepared?: boolean;
  /** Owner cancellation, e.g. a server render merging request and reader aborts. */
  readonly signal?: AbortSignal;
}

export async function prepareInitialRoutedRuntime(
  runtime: RouteRuntime,
  options: InitialRoutedPreparationOptions = {},
): Promise<RoutedPreparationOutcome> {
  const { serverContext, reusePrepared = false } = options;
  return prepareRoutedMatches(runtime, runtime.route.matches, {
    href: runtime.route.href,
    params: runtime.route.params,
    signal: options.signal ?? serverContext?.request.signal ?? runtime.route.signal,
    reusePrepared,
    ...(serverContext === undefined ? {} : { serverContext }),
  });
}

function jsonClone(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return undefined;
  return JSON.parse(serialized) as unknown;
}

function transportState(
  state: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const transported: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    try {
      const cloned = jsonClone(value);
      if (cloned !== undefined) transported[key] = cloned;
    } catch {
      // The state bag itself is unrestricted. Only its transport boundary is
      // JSON-shaped; server-local keys remain usable during the request.
    }
  }
  return Object.freeze(transported);
}

export function serializeRoutedPreparationState(
  runtime: RouteRuntime,
): SerializedRoutedPreparationState | undefined {
  const values = preparedByRuntime.get(runtime);
  if (values === undefined || values.size === 0) return undefined;
  const states = cacheStateByRuntime.get(runtime);
  const entries = [...values].map(([id, data]) => {
    let transportedData: unknown;
    try {
      transportedData = jsonClone(data);
    } catch (error) {
      throw new TypeError(
        `memo-dom: routed preparation '${id}' returned data that cannot be transported`,
        { cause: error },
      );
    }
    return Object.freeze({
      id,
      data: transportedData,
      state: transportState(states?.get(id) ?? {}),
    });
  });
  return Object.freeze({ version: 1, entries: Object.freeze(entries) });
}

export function restoreRoutedPreparationState(
  runtime: RouteRuntime,
  serialized: SerializedRoutedPreparationState,
): void {
  if (
    typeof serialized !== 'object' ||
    serialized === null ||
    serialized.version !== 1 ||
    !Array.isArray(serialized.entries)
  ) return;
  let values = preparedByRuntime.get(runtime);
  if (values === undefined) {
    values = new Map();
    preparedByRuntime.set(runtime, values);
  }
  let states = cacheStateByRuntime.get(runtime);
  if (states === undefined) {
    states = new Map();
    cacheStateByRuntime.set(runtime, states);
  }
  for (const entry of serialized.entries) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof entry.id !== 'string' ||
      typeof entry.state !== 'object' ||
      entry.state === null ||
      Array.isArray(entry.state)
    ) continue;
    values.set(entry.id, entry.data);
    states.set(entry.id, { ...entry.state });
  }
}

export function readRoutedPreparation(
  runtime: RouteRuntime,
  id: string,
): unknown {
  const values = preparedByRuntime.get(runtime);
  const match = [...runtime.route.matches].reverse().find(candidate =>
    ((candidate.metadata as RoutedPreparationMetadata | undefined)?.preparations ?? [])
      .includes(id));
  const key = match === undefined ? id : preparationKey(match.id, id);
  if (values?.has(key) !== true) {
    throw new Error(
      `memo-dom: routed preparation '${id}' was read before it became ready`,
    );
  }
  return values.get(key);
}

/** Server endpoint dispatch. Server-only context is attached here, never serialized. */
export async function invokeServerRoutedPreparation(
  input: {
    readonly id: string;
    readonly href: string;
    readonly params: Readonly<Record<string, string>>;
    readonly state?: Readonly<Record<string, unknown>>;
  },
  context: RoutedServerContext,
): Promise<RoutedPreparationOutcome> {
  const definition = definitions.get(input.id);
  if (definition?.prepare === undefined) {
    throw new Error(`memo-dom: missing server routed preparation '${input.id}'`);
  }
  const url = new URL(input.href, context.request.url);
  const state: RoutedCacheState = { ...input.state };
  const returned = await definition.prepare(Object.freeze({
    state,
    params: Object.freeze({ ...input.params }),
    url,
    query: routeQuery(url),
    request: context.request,
    locals: context.locals,
    platform: context.platform,
    services: context.services,
    signal: context.request.signal,
  }));
  const value = await (
    definition.settle?.(returned, context.request.signal) ??
    returned
  );
  return isRedirect(value)
    ? {
        kind: 'redirect',
        redirect: {
          ...value,
          to: value.to instanceof URL ? value.to.href : value.to,
        },
      }
    : { kind: 'data', data: value, state: transportState(state) };
}

// Restoring routed data belongs to preparation, not ordinary URL navigation.
// Data preparation and public construction retain this capability.
installRouteModuleLoader(prepareRouteModules);
installRoutePreparationRunner(createRoutePreparationTransaction);

interface RouterPreparationBridge {
  restoreState?(state: unknown): void;
  pendingState?: unknown;
}

const routerRuntimeBridgeKey = Symbol.for(
  'memoized-dom:router-runtime-bridge',
);
const routedBridgeRealm = globalThis as unknown as Record<PropertyKey, unknown>;
const routedBridgeExisting = routedBridgeRealm[routerRuntimeBridgeKey];
const routedBridge =
  typeof routedBridgeExisting === 'object' && routedBridgeExisting !== null
    ? routedBridgeExisting as RouterPreparationBridge
    : {};
routedBridgeRealm[routerRuntimeBridgeKey] = routedBridge;
routedBridge.restoreState = state => {
  restoreRoutedPreparationState(
    getActiveRouteRuntime(),
    state as SerializedRoutedPreparationState,
  );
};
if (routedBridge.pendingState !== undefined) {
  routedBridge.restoreState(routedBridge.pendingState);
  routedBridge.pendingState = undefined;
}
