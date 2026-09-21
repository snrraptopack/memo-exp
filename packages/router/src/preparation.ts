import type { RouteRuntime } from './runtime';
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
}

export interface RoutedPreparationInput {
  readonly href: string;
  readonly params: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export interface RoutedServerContext {
  readonly request: Request;
  readonly locals: object;
  readonly platform?: unknown;
  readonly services: object;
}

export type RoutedPreparationOutcome =
  | { readonly kind: 'data'; readonly data: unknown }
  | { readonly kind: 'redirect'; readonly redirect: RouteRedirect };

const definitions = new Map<string, RoutedPreparationDefinition>();
const preparedByRuntime = new WeakMap<RouteRuntime, Map<string, unknown>>();
const cacheStateByRuntime = new WeakMap<RouteRuntime, Map<string, RoutedCacheState>>();

function preparationIds(matches: readonly RouteMatch[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const metadata = match.metadata as RoutedPreparationMetadata | undefined;
    for (const id of metadata?.preparations ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
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
    state = Object.freeze({});
    states.set(id, state);
  }
  return state;
}

function browserContext(
  runtime: RouteRuntime,
  id: string,
  input: RoutedPreparationInput,
): RoutedContext {
  const url = new URL(input.href);
  return Object.freeze({
    state: stateFor(runtime, id),
    params: input.params,
    url,
    query: routeQuery(url),
    request: new Request(url, { signal: input.signal }),
    locals: Object.freeze({}),
    platform: undefined,
    services: Object.freeze({}),
    signal: input.signal,
  });
}

async function invokeBrowserServerPreparation(
  id: string,
  input: RoutedPreparationInput,
): Promise<RoutedPreparationOutcome> {
  const response = await fetch(ROUTED_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, href: input.href, params: input.params }),
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

export function hasRoutedPreparations(matches: readonly RouteMatch[]): boolean {
  return preparationIds(matches).length > 0;
}

/** Run matched preparations in parent-to-child declaration order. */
export async function prepareRoutedMatches(
  runtime: RouteRuntime,
  matches: readonly RouteMatch[],
  input: RoutedPreparationInput,
): Promise<RoutedPreparationOutcome> {
  const pending = new Map<string, unknown>();
  for (const id of preparationIds(matches)) {
    if (input.signal.aborted) throw input.signal.reason;
    const definition = definitions.get(id);
    if (definition === undefined) {
      throw new Error(`memo-dom: missing routed preparation '${id}'`);
    }
    const outcome = definition.prepare === undefined
      ? await invokeBrowserServerPreparation(id, input)
      : await (() => {
          const value = definition.prepare!(browserContext(runtime, id, input));
          return definition.settle?.(value, input.signal) ?? Promise.resolve(value);
        })().then(data => isRedirect(data)
          ? { kind: 'redirect', redirect: data } as const
          : { kind: 'data', data } as const);
    if (outcome.kind === 'redirect') return outcome;
    pending.set(id, outcome.data);
  }
  let prepared = preparedByRuntime.get(runtime);
  if (prepared === undefined) {
    prepared = new Map();
    preparedByRuntime.set(runtime, prepared);
  }
  for (const [id, value] of pending) prepared.set(id, value);
  return { kind: 'data', data: undefined };
}

export function readRoutedPreparation(
  runtime: RouteRuntime,
  id: string,
): unknown {
  const values = preparedByRuntime.get(runtime);
  if (values?.has(id) !== true) {
    throw new Error(
      `memo-dom: routed preparation '${id}' was read before it became ready`,
    );
  }
  return values.get(id);
}

/** Server endpoint dispatch. Server-only context is attached here, never serialized. */
export async function invokeServerRoutedPreparation(
  input: { readonly id: string; readonly href: string; readonly params: Readonly<Record<string, string>> },
  context: RoutedServerContext,
): Promise<RoutedPreparationOutcome> {
  const definition = definitions.get(input.id);
  if (definition?.prepare === undefined) {
    throw new Error(`memo-dom: missing server routed preparation '${input.id}'`);
  }
  const url = new URL(input.href, context.request.url);
  const returned = definition.prepare(Object.freeze({
    state: Object.freeze({}),
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
    Promise.resolve(returned)
  );
  return isRedirect(value)
    ? {
        kind: 'redirect',
        redirect: {
          ...value,
          to: value.to instanceof URL ? value.to.href : value.to,
        },
      }
    : { kind: 'data', data: value };
}
