import {
  buildRoutePath,
  normalizeRoutePath,
  resolveRoutePath,
  validateRoutePattern,
} from './path';
import { createRouteManifest } from './manifest';
import { createScrollCoordinator } from './scroll';
import {
  hasRoutedPreparations,
  prepareRoutedMatches,
} from './preparation';
import {
  RouteHistoryCommittedUpdateError,
  type RouteHistory,
} from './history';
import type {
  NavigateOptions,
  NavigateArguments,
  NavigationType,
  RouteListener,
  RouteLocationSnapshot,
  RouteMatch,
  RouteNavigation,
  RouteNavigationBlocker,
  RouteNavigationEvent,
  RouteNavigationListener,
  RouteNavigationLocation,
  RouteNavigationResult,
  RouteNavigationSettledResult,
  RoutePatternDefinition,
  RouteQuery,
  RouteResolver,
  RouteSelectionEquality,
  RouteSelectionListener,
  RouteSelector,
  RouteSnapshot,
  RouteState,
  RelativeNavigateArguments,
  RelativeNavigateOptions,
} from './types';

const FALLBACK_ORIGIN = 'http://memoized-dom.local';

export interface RouteEnvironment {
  readonly location?: Location;
  readonly history?: History;
  readonly navigation?: NavigationController;
  addEventListener?(
    type: 'popstate' | 'hashchange' | 'click',
    listener: EventListener,
  ): void;
  removeEventListener?(
    type: 'popstate' | 'hashchange' | 'click',
    listener: EventListener,
  ): void;
}

export interface NavigationDestinationLike {
  readonly url: string;
  getState?(): unknown;
}

export interface NavigationEventLike extends Event {
  readonly canIntercept: boolean;
  readonly destination: NavigationDestinationLike;
  readonly downloadRequest?: string | null;
  readonly hashChange: boolean;
  readonly navigationType: 'push' | 'replace' | 'reload' | 'traverse';
  scroll?(): void;
  intercept(options?: {
    readonly handler?: () => Promise<void> | void;
    readonly scroll?: 'after-transition' | 'manual';
  }): void;
}

export interface NavigationController {
  addEventListener(type: 'navigate', listener: EventListener): void;
  removeEventListener(type: 'navigate', listener: EventListener): void;
  navigate(
    url: string,
    options?: {
      readonly history?: 'auto' | 'push' | 'replace';
      readonly state?: unknown;
    },
  ): unknown;
  back(): unknown;
  forward(): unknown;
}

export interface RouteRuntime {
  readonly route: RouteState;
  snapshot(): RouteSnapshot;
  subscribe(listener: RouteListener): () => void;
  subscribeSelected<Value>(
    selector: RouteSelector<Value>,
    listener: RouteSelectionListener<Value>,
    equals?: RouteSelectionEquality<Value>,
  ): () => void;
  connect(): () => void;
  installResolver(resolver: RouteResolver): () => void;
  replaceResolver(resolver: RouteResolver): () => void;
  navigate<Path extends string>(
    pattern: Path,
    ...arguments_: NavigateArguments<Path>
  ): RouteNavigationResult;
  navigateRelative<Path extends string>(
    pattern: Path,
    ...arguments_: RelativeNavigateArguments<Path>
  ): RouteNavigationResult;
  blockNavigation(blocker: RouteNavigationBlocker): () => void;
  subscribeNavigation(listener: RouteNavigationListener): () => void;
  back(): RouteNavigationResult | null;
  forward(): RouteNavigationResult | null;
  setLocation(href: string | URL, type?: NavigationType, state?: unknown): void;
  setMatches(matches: readonly RouteMatch[]): void;
  dispose(): void;
}

export function supportsNavigationAPI(
  environment: RouteEnvironment = typeof window === 'undefined' ? {} : (window as unknown as RouteEnvironment),
): boolean {
  return environment.navigation !== undefined;
}

function initialURL(environment: RouteEnvironment): URL {
  const href = environment.location?.href;
  return new URL(href ?? '/', href ?? FALLBACK_ORIGIN);
}

function frozenMatch(match: RouteMatch): RouteMatch {
  return Object.freeze({
    ...match,
    params: Object.freeze({ ...match.params }),
  });
}

const queryParamsCache = new WeakMap<FastRouteQuery, URLSearchParams>();

class FastRouteQuery implements RouteQuery {
  private readonly _search: string;

  constructor(search: string) {
    this._search = search;
  }

  private _ensure(): URLSearchParams {
    let params = queryParamsCache.get(this);
    if (params === undefined) {
      params = new URLSearchParams(this._search);
      queryParamsCache.set(this, params);
    }
    return params;
  }

  get size(): number {
    return this._ensure().size;
  }

  get(name: string): string | null {
    return this._ensure().get(name);
  }

  getAll(name: string): string[] {
    return this._ensure().getAll(name);
  }

  has(name: string, value?: string): boolean {
    return this._ensure().has(name, value);
  }

  entries(): URLSearchParamsIterator<[string, string]> {
    return this._ensure().entries();
  }

  keys(): URLSearchParamsIterator<string> {
    return this._ensure().keys();
  }

  values(): URLSearchParamsIterator<string> {
    return this._ensure().values();
  }

  forEach(
    callback: (value: string, key: string, query: RouteQuery) => void,
    thisArg?: unknown,
  ): void {
    const params = this._ensure();
    params.forEach((value, key) => callback.call(thisArg, value, key, this as RouteQuery));
  }

  toString(): string {
    return this._search.startsWith('?') ? this._search.slice(1) : this._search;
  }

  [Symbol.iterator](): URLSearchParamsIterator<[string, string]> {
    return this._ensure()[Symbol.iterator]();
  }
}

function readonlyQuery(search: string): RouteQuery {
  return Object.freeze(new FastRouteQuery(search));
}

export interface RouteRuntimeOptions {
  readonly environment?: RouteEnvironment;
  readonly routeHistory?: RouteHistory;
  readonly resolver?: RouteResolver;
  readonly routes?: readonly (RoutePatternDefinition | string)[];
  /** Static URL prefix where the application is mounted, such as `/app`. */
  readonly basePath?: string;
}

function prepareMatches(nextMatches: readonly RouteMatch[]): {
  readonly matches: readonly RouteMatch[];
  readonly params: Readonly<Record<string, string>>;
} {
  const len = nextMatches.length;
  if (len === 0) {
    return {
      matches: Object.freeze([]),
      params: Object.freeze({}),
    };
  }

  // Fast single-match path (no Set allocation, for..in iteration)
  if (len === 1) {
    const match = nextMatches[0]!;
    if (match.id.trim() === '') throw new TypeError('Route match IDs must not be empty');
    const pattern = validateRoutePattern(match.pattern);
    const merged: Record<string, string> = {};
    for (const key in match.params) {
      merged[key] = match.params[key]!;
    }
    return {
      matches: Object.freeze([frozenMatch({ ...match, pattern })]),
      params: Object.freeze(merged),
    };
  }

  const identifiers = new Set<string>();
  const merged: Record<string, string> = {};
  const frozen: RouteMatch[] = new Array(len);
  for (let i = 0; i < len; i++) {
    const match = nextMatches[i]!;
    if (match.id.trim() === '') throw new TypeError('Route match IDs must not be empty');
    if (identifiers.has(match.id)) {
      throw new TypeError(`Duplicate active route ID '${match.id}'`);
    }
    identifiers.add(match.id);
    const pattern = validateRoutePattern(match.pattern);
    for (const key in match.params) {
      if (Object.hasOwn(merged, key)) {
        throw new TypeError(`Duplicate active route parameter '${key}'`);
      }
      merged[key] = match.params[key]!;
    }
    frozen[i] = frozenMatch({ ...match, pattern });
  }
  return {
    matches: Object.freeze(frozen),
    params: Object.freeze(merged),
  };
}

function sameMatches(
  first: readonly RouteMatch[],
  second: readonly RouteMatch[],
): boolean {
  if (first.length !== second.length) return false;
  return first.every((match, index) => {
    const other = second[index];
    if (
      other === undefined ||
      match.id !== other.id ||
      match.pattern !== other.pattern ||
      match.pathname !== other.pathname
    ) return false;
    const keys = Object.keys(match.params);
    return keys.length === Object.keys(other.params).length &&
      keys.every(key => match.params[key] === other.params[key]);
  });
}
function wrapHistoryState(userState: unknown, key: string): unknown {
  if (userState !== null && typeof userState === 'object' && !Array.isArray(userState)) {
    return { ...userState, __mmd_key: key };
  }
  return { __mmd_val: userState, __mmd_key: key };
}

function unwrapHistoryState(storedState: unknown): { userState: unknown; key: string | null } {
  if (storedState !== null && typeof storedState === 'object') {
    const obj = storedState as Record<string, unknown>;
    const key = typeof obj.__mmd_key === 'string' ? obj.__mmd_key : null;
    if ('__mmd_val' in obj) {
      return { userState: obj.__mmd_val, key };
    }
    if (key !== null) {
      const { __mmd_key, ...rest } = obj;
      return { userState: rest, key };
    }
  }
  return { userState: storedState, key: null };
}

function generateHistoryKey(): string {
  return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createRouteRuntime(
  optionsOrEnvironment: RouteEnvironment | RouteRuntimeOptions = typeof window === 'undefined' ? {} : (window as unknown as RouteEnvironment),
): RouteRuntime {
  const isOptions = typeof optionsOrEnvironment === 'object' && optionsOrEnvironment !== null &&
    ('routes' in optionsOrEnvironment ||
      'resolver' in optionsOrEnvironment ||
      'environment' in optionsOrEnvironment ||
      'routeHistory' in optionsOrEnvironment ||
      'basePath' in optionsOrEnvironment);

  const options: RouteRuntimeOptions = isOptions
    ? (optionsOrEnvironment as RouteRuntimeOptions)
    : { environment: optionsOrEnvironment as RouteEnvironment };

  const environment: RouteEnvironment = options.environment ?? (typeof window === 'undefined' ? {} : (window as unknown as RouteEnvironment));
  const routeHistory = options.routeHistory;
  const basePath = validateRoutePattern(options.basePath ?? '/');
  if (basePath.includes(':') || basePath.includes('*')) {
    throw new TypeError('Route runtime basePath must be static');
  }

  function applicationPathname(pathname: string): string | null {
    const normalized = normalizeRoutePath(pathname);
    if (basePath === '/') return normalized;
    if (normalized === basePath) return '/';
    if (normalized.startsWith(`${basePath}/`)) {
      return normalized.slice(basePath.length);
    }
    return null;
  }

  function applicationURL(href: string): URL {
    const destination = new URL(href, FALLBACK_ORIGIN);
    if (destination.origin !== FALLBACK_ORIGIN) {
      throw new TypeError(`Route destination '${href}' must be application-relative`);
    }
    const routePath = normalizeRoutePath(destination.pathname);
    const mountedPath = basePath === '/'
      ? routePath
      : routePath === '/' ? basePath : `${basePath}${routePath}`;
    return new URL(`${mountedPath}${destination.search}${destination.hash}`, url);
  }

  let url = routeHistory === undefined
    ? initialURL(environment)
    : new URL(routeHistory.location.href, FALLBACK_ORIGIN);
  const initialPathname = applicationPathname(url.pathname);
  if (initialPathname === null) {
    throw new TypeError(
      `Initial URL pathname '${url.pathname}' is outside router basePath '${basePath}'`,
    );
  }
  let pathname: string = initialPathname;
  const initialUnwrapped = unwrapHistoryState(
    routeHistory?.location.state ?? environment.history?.state ?? null,
  );
  let state: unknown = initialUnwrapped.userState;
  let currentHistoryKey: string = initialUnwrapped.key ?? generateHistoryKey();
  const scrollCoordinator = createScrollCoordinator({
    window: typeof window === 'undefined' ? undefined : window,
    document: typeof document === 'undefined' ? undefined : document,
    history: environment.history,
  });
  let disconnectScroll: (() => void) | null = null;
  let navigationType: NavigationType = 'load';
  let matches: readonly RouteMatch[] = Object.freeze([]);
  let params: Readonly<Record<string, string>> = Object.freeze({});
  let query = readonlyQuery(url.search);
  let controller = new AbortController();
  let controllerAccessed = false;
  let connectionCount = 0;
  let disposed = false;
  let resolver: RouteResolver | null = options.resolver ?? null;
  if (resolver === null && options.routes !== undefined) {
    const manifest = createRouteManifest(options.routes);
    resolver = manifest.resolve.bind(manifest);
  }
  let resolving = false;
  let blocking = false;
  let revision = 0;
  let locationRevision = 0;
  let navigationEventRevision = 0;
  let navigationId = 0;
  let committingNavigation = 0;
  let activePreparation: AbortController | null = null;
  let emitting = false;
  let emissionPending = false;
  const listeners = new Set<RouteListener>();
  const selectedListeners = new Set<{
    selector: RouteSelector<unknown>;
    listener: RouteSelectionListener<unknown>;
    equals: RouteSelectionEquality<unknown>;
    value: unknown;
  }>();
  const navigationBlockers = new Set<RouteNavigationBlocker>();
  const navigationListeners = new Set<RouteNavigationListener>();
  let unsubscribeRouteHistory: (() => void) | null = null;

  const route: RouteState = Object.freeze({
    get href() { return url.href; },
    get pathname() { return pathname; },
    get search() { return url.search; },
    get query() { return query; },
    get hash() { return url.hash; },
    get state() { return state; },
    get navigationType() { return navigationType; },
    get params() { return params; },
    get matches() { return matches; },
    get matched() { return matches.at(-1) ?? null; },
    get signal() {
      controllerAccessed = true;
      return controller.signal;
    },
  });

  function snapshot(): RouteSnapshot {
    return Object.freeze({
      href: route.href,
      pathname: route.pathname,
      search: route.search,
      query: route.query,
      hash: route.hash,
      state: route.state,
      navigationType: route.navigationType,
      params: route.params,
      matches: route.matches,
      matched: route.matched,
      signal: route.signal,
    });
  }

  function locationSnapshot(): RouteLocationSnapshot {
    return Object.freeze({
      href: url.href,
      pathname,
      search: url.search,
      query,
      hash: url.hash,
      state,
      navigationType,
      get signal() {
        controllerAccessed = true;
        return controller.signal;
      },
    });
  }

  function emit(): void {
    revision++;
    if (listeners.size === 0 && selectedListeners.size === 0) return;
    if (emitting) {
      emissionPending = true;
      return;
    }

    emitting = true;
    const errors: unknown[] = [];
    try {
      do {
        emissionPending = false;
        const emittedRevision = revision;
        if (listeners.size !== 0) {
          const value = snapshot();
          for (const listener of [...listeners]) {
            if (!listeners.has(listener)) continue;
            try {
              listener(value);
            } catch (error) {
              errors.push(error);
            }
            if (revision !== emittedRevision) {
              emissionPending = true;
              break;
            }
          }
        }
        if (revision !== emittedRevision) continue;
        for (const subscription of [...selectedListeners]) {
          if (!selectedListeners.has(subscription)) continue;
          try {
            const nextValue = subscription.selector(route);
            if (!subscription.equals(subscription.value, nextValue)) {
              subscription.value = nextValue;
              subscription.listener(nextValue, route);
            }
          } catch (error) {
            errors.push(error);
          }
          if (revision !== emittedRevision) {
            emissionPending = true;
            break;
          }
        }
      } while (emissionPending);
    } finally {
      emitting = false;
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Route listeners failed');
  }

  function runResolver(nextResolver: RouteResolver): ReturnType<typeof prepareMatches> {
    if (resolving) throw new Error('Route resolvers must not mutate router state');
    resolving = true;
    try {
      return prepareMatches(nextResolver(locationSnapshot()));
    } finally {
      resolving = false;
    }
  }

  function resolveDestination(
    destination: URL,
    type: NavigationType,
    destinationState: unknown,
    signal: AbortSignal,
  ): ReturnType<typeof prepareMatches> {
    if (resolver === null) return prepareMatches([]);
    const destinationPathname = applicationPathname(destination.pathname);
    if (destinationPathname === null) {
      throw new TypeError(
        `URL pathname '${destination.pathname}' is outside router basePath '${basePath}'`,
      );
    }
    if (resolving) throw new Error('Route resolvers must not mutate router state');
    resolving = true;
    try {
      return prepareMatches(resolver(Object.freeze({
        href: destination.href,
        pathname: destinationPathname,
        search: destination.search,
        query: readonlyQuery(destination.search),
        hash: destination.hash,
        state: destinationState,
        navigationType: type,
        signal,
      })));
    } finally {
      resolving = false;
    }
  }

  if (resolver !== null) {
    const initialPrepared = runResolver(resolver);
    matches = initialPrepared.matches;
    params = initialPrepared.params;
  }

  function setLocation(
    href: string | URL,
    type: NavigationType = 'replace',
    nextState: unknown = null,
    fromRouteHistory = false,
  ): void {
    if (disposed) throw new Error('Cannot set location on a disposed route runtime');
    if (resolving || blocking) {
      throw new Error('Route resolvers and blockers must not mutate router state');
    }
    const next = typeof href === 'string' ? new URL(href, url) : href;
    const nextPathname = applicationPathname(next.pathname);
    if (nextPathname === null) {
      throw new TypeError(
        `URL pathname '${next.pathname}' is outside router basePath '${basePath}'`,
      );
    }
    const changed = next.href !== url.href || !Object.is(nextState, state);
    if (!changed) return;

    const previousURL = url;
    const previousPathname = pathname;
    const previousState = state;
    const previousNavigationType = navigationType;
    const previousQuery = query;
    const previousController = controller;
    const hadAccessedController = controllerAccessed;
    if (hadAccessedController) {
      controller = new AbortController();
      controllerAccessed = false;
    }
    url = next;
    pathname = nextPathname;
    state = nextState;
    navigationType = type;
    query = readonlyQuery(url.search);
    let prepared: ReturnType<typeof prepareMatches>;
    try {
      prepared = resolver === null ? prepareMatches([]) : runResolver(resolver);
    } catch (error) {
      url = previousURL;
      pathname = previousPathname;
      state = previousState;
      navigationType = previousNavigationType;
      query = previousQuery;
      if (hadAccessedController) {
        controller.abort();
        controller = previousController;
        controllerAccessed = hadAccessedController;
      }
      throw error;
    }
    matches = prepared.matches;
    params = prepared.params;
    if (hadAccessedController) {
      previousController.abort();
    }
    locationRevision++;
    try {
      emit();
    } catch (error) {
      if (fromRouteHistory) throw new RouteHistoryCommittedUpdateError(error);
      throw error;
    }
    scrollCoordinator.restore(url, navigationType, currentHistoryKey);
  }

  if (routeHistory !== undefined) {
    unsubscribeRouteHistory = routeHistory.subscribe(update => {
      setLocation(update.location.href, update.action, update.location.state, true);
    });
  }

  function navigationLocation(
    locationURL: URL,
    locationState: unknown,
  ): RouteNavigationLocation {
    if (locationURL.origin !== url.origin) {
      throw new TypeError(`Route destination '${locationURL.href}' must be same-origin`);
    }
    const routePathname = applicationPathname(locationURL.pathname);
    if (routePathname === null) {
      throw new TypeError(
        `URL pathname '${locationURL.pathname}' is outside router basePath '${basePath}'`,
      );
    }
    return Object.freeze({
      href: locationURL.href,
      pathname: routePathname,
      search: locationURL.search,
      hash: locationURL.hash,
      state: locationState,
    });
  }

  function navigationRecord(
    id: number,
    from: RouteNavigationLocation,
    next: URL,
    options: Pick<NavigateOptions, 'replace' | 'state'>,
    type: Exclude<NavigationType, 'load'> = options.replace ? 'replace' : 'push',
  ): RouteNavigation {
    return Object.freeze({
      id,
      from,
      to: navigationLocation(next, options.state ?? null),
      type,
    });
  }

  function emitNavigation(event: RouteNavigationEvent): void {
    const errors: unknown[] = [];
    for (const listener of [...navigationListeners]) {
      if (!navigationListeners.has(listener)) continue;
      try {
        listener(event);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Route navigation listeners failed');
    }
  }

  function prepareNavigation(
    initial: URL,
    initialOptions: Pick<NavigateOptions, 'replace' | 'state'>,
    initialType: Exclude<NavigationType, 'load'> = initialOptions.replace
      ? 'replace'
      : 'push',
  ):
    | {
        readonly status: 'ready';
        readonly next: URL;
        readonly options: Pick<NavigateOptions, 'replace' | 'state'>;
        readonly navigation: RouteNavigation;
        readonly redirects: number;
      }
    | Extract<RouteNavigationResult, { readonly status: 'blocked' }> {
    const id = ++navigationId;
    const from = navigationLocation(url, state);
    let next = initial;
    let nextOptions = initialOptions;
    let nextType = initialType;
    let redirects = 0;

    while (true) {
      const navigation = navigationRecord(id, from, next, nextOptions, nextType);
      if (redirects === 0) {
        emitNavigation(Object.freeze({ phase: 'start', navigation }));
      }

      let redirected = false;
      blocking = true;
      try {
        for (const blocker of [...navigationBlockers]) {
          if (!navigationBlockers.has(blocker)) continue;
          const decision = blocker(navigation);
          if (
            typeof decision === 'object' &&
            decision !== null &&
            'then' in decision
          ) {
            throw new TypeError(
              'Route navigation blockers must be synchronous; async work belongs to the data boundary',
            );
          }
          if (decision === false) {
            emitNavigation(Object.freeze({ phase: 'blocked', navigation }));
            return Object.freeze({ status: 'blocked', navigation, redirects });
          }
          if (typeof decision === 'object' && decision !== null && 'to' in decision) {
            redirects++;
            if (redirects > 16) {
              throw new Error('Route navigation exceeded 16 redirects');
            }
            emitNavigation(Object.freeze({
              phase: 'redirect',
              navigation,
              redirect: decision,
            }));
            if (decision.to instanceof URL) {
              next = new URL(decision.to.href);
            } else {
              const redirectedPath = resolveRoutePath(
                navigation.to.pathname,
                decision.to,
              );
              next = applicationURL(redirectedPath);
            }
            nextOptions = {
              replace: decision.replace ?? nextOptions.replace,
              state: decision.state ?? null,
            };
            nextType = nextOptions.replace ? 'replace' : 'push';
            redirected = true;
            break;
          }
        }
      } finally {
        blocking = false;
      }
      if (!redirected) {
        return {
          status: 'ready',
          next,
          options: nextOptions,
          navigation,
          redirects,
        };
      }
    }
  }

  const onPopState: EventListener = () => {
    const location = environment.location;
    if (
      location !== undefined &&
      applicationPathname(new URL(location.href).pathname) !== null
    ) {
      const { userState, key } = unwrapHistoryState(environment.history?.state ?? null);
      if (key !== null) currentHistoryKey = key;
      setLocation(location.href, 'pop', userState);
    }
  };

  const onHashChange: EventListener = () => {
    const location = environment.location;
    if (
      location !== undefined &&
      location.href !== url.href &&
      applicationPathname(new URL(location.href).pathname) !== null
    ) {
      setLocation(location.href, 'pop', environment.history?.state ?? null);
    }
  };

  const onClick: EventListener = event => {
    const mouseEvent = event as MouseEvent;
    if (
      mouseEvent.defaultPrevented ||
      mouseEvent.button !== 0 ||
      mouseEvent.metaKey ||
      mouseEvent.ctrlKey ||
      mouseEvent.shiftKey ||
      mouseEvent.altKey
    ) return;

    const pathAnchor = mouseEvent.composedPath().find(
      target => target instanceof HTMLAnchorElement && target.hasAttribute('href'),
    ) as HTMLAnchorElement | undefined;
    const target = mouseEvent.target;
    const anchor = pathAnchor ?? (target instanceof Element
      ? target.closest<HTMLAnchorElement>('a[href]')
      : null);
    if (
      anchor === null ||
      anchor.hasAttribute('download') ||
      (anchor.target !== '' && anchor.target.toLowerCase() !== '_self') ||
      anchor.relList.contains('external')
    ) return;

    const destination = new URL(anchor.href, url);
    if (
      destination.origin !== url.origin ||
      applicationPathname(destination.pathname) === null ||
      (destination.protocol !== 'http:' && destination.protocol !== 'https:')
    ) return;
    if (
      destination.pathname === url.pathname &&
      destination.search === url.search &&
      destination.hash !== url.hash
    ) return;

    mouseEvent.preventDefault();
    navigateToURL(destination, { state: null });
  };

  const onNavigate: EventListener = event => {
    navigationEventRevision++;
    const navigationEvent = event as NavigationEventLike;
    if (
      !navigationEvent.canIntercept ||
      navigationEvent.downloadRequest !== null &&
      navigationEvent.downloadRequest !== undefined
    ) return;

    const destination = new URL(navigationEvent.destination.url, url);
    if (
      destination.origin !== url.origin ||
      applicationPathname(destination.pathname) === null
    ) return;
    const type: NavigationType = navigationEvent.navigationType === 'traverse'
      ? 'pop'
      : navigationEvent.navigationType === 'push'
        ? 'push'
        : 'replace';
    const destinationState = navigationEvent.destination.getState?.() ?? null;

    if (committingNavigation === 0) {
      const prepared = prepareNavigation(destination, {
        replace: type !== 'push',
        state: destinationState,
      }, type);
      if (prepared.status === 'blocked') {
        navigationEvent.preventDefault();
        return;
      }
      if (prepared.next.href !== destination.href) {
        navigationEvent.preventDefault();
        const result = executePreparedNavigation(prepared);
        if (result.status === 'preparing') void result.finished.catch(() => {});
        return;
      }
      const probe = new AbortController();
      const destinationMatches = resolveDestination(
        destination,
        type,
        destinationState,
        probe.signal,
      );
      if (hasRoutedPreparations(destinationMatches.matches)) {
        if (type !== 'pop') {
          navigationEvent.preventDefault();
          const result = executePreparedNavigation(prepared);
          if (result.status === 'preparing') void result.finished.catch(() => {});
          return;
        }

        if (activePreparation !== null) {
          const superseded = activePreparation;
          activePreparation = null;
          superseded.abort(
            new DOMException('Route preparation was superseded', 'AbortError'),
          );
        }
        activePreparation = probe;
        emitNavigation(Object.freeze({
          phase: 'prepare',
          navigation: prepared.navigation,
        }));
        const traversal = prepareRoutedMatches(runtime, destinationMatches.matches, {
          href: destination.href,
          params: destinationMatches.params,
          signal: probe.signal,
        }).then(outcome => {
          if (activePreparation !== probe || probe.signal.aborted) {
            throw probe.signal.reason ?? new DOMException(
              'Route preparation was superseded',
              'AbortError',
            );
          }
          activePreparation = null;
          if (outcome.kind === 'redirect') {
            const redirected = outcome.redirect.to instanceof URL
              ? outcome.redirect.to
              : applicationURL(resolveRoutePath(
                  prepared.navigation.to.pathname,
                  outcome.redirect.to,
                ));
            const result = navigateToURL(redirected, {
              replace: outcome.redirect.replace ?? true,
              state: outcome.redirect.state ?? null,
            });
            return result.status === 'preparing' ? result.finished : result;
          }
          setLocation(destination, 'pop', destinationState);
          emitNavigation(Object.freeze({
            phase: 'complete',
            navigation: prepared.navigation,
          }));
        }).catch(error => {
          if (activePreparation === probe) activePreparation = null;
          if (!probe.signal.aborted) {
            emitNavigation(Object.freeze({
              phase: 'error',
              navigation: prepared.navigation,
              error,
              retry: () => navigateToURL(destination, {
                replace: true,
                state: destinationState,
              }),
            }));
          }
          throw error;
        });
        navigationEvent.intercept({
          scroll: 'after-transition',
          async handler() {
            await traversal;
          },
        });
        return;
      }
      if (activePreparation !== null) {
        const superseded = activePreparation;
        activePreparation = null;
        superseded.abort(
          new DOMException('Route preparation was superseded', 'AbortError'),
        );
      }
      setLocation(destination, type, destinationState);
      emitNavigation(Object.freeze({
        phase: 'complete',
        navigation: prepared.navigation,
      }));
      if (!navigationEvent.hashChange) {
        navigationEvent.intercept({
          scroll: 'after-transition',
          async handler() {
            await Promise.resolve();
          },
        });
      }
      return;
    }

    if (navigationEvent.hashChange) {
      setLocation(destination, type, destinationState);
      return;
    }

    setLocation(destination, type, destinationState);
    navigationEvent.intercept({
      scroll: 'after-transition',
      async handler() {
        // Route subscribers render from the synchronous location update.
        // Yielding here lets their microtask commit settle before navigation
        // success and the browser's post-navigation behavior run.
        await Promise.resolve();
      },
    });
  };

  function disconnect(): void {
    if (resolving) throw new Error('Route resolvers must not mutate router state');
    if (connectionCount === 0) return;
    connectionCount--;
    if (connectionCount !== 0) return;
    disconnectScroll?.();
    disconnectScroll = null;
    if (routeHistory !== undefined) {
      return;
    } else if (supportsNavigationAPI(environment)) {
      environment.navigation!.removeEventListener('navigate', onNavigate);
    } else {
      environment.removeEventListener?.('popstate', onPopState);
      environment.removeEventListener?.('hashchange', onHashChange);
      environment.removeEventListener?.('click', onClick);
    }
  }

  function connect(): () => void {
    if (disposed) throw new Error('Cannot connect a disposed route runtime');
    if (resolving) throw new Error('Route resolvers must not mutate router state');
    connectionCount++;
    try {
      if (connectionCount === 1) {
        disconnectScroll = scrollCoordinator.connect();
        if (routeHistory !== undefined) {
          // RouteHistory subscriptions are owned for the entire runtime lifetime.
        } else if (supportsNavigationAPI(environment)) {
          environment.navigation!.addEventListener('navigate', onNavigate);
        } else {
          environment.addEventListener?.('popstate', onPopState);
          environment.addEventListener?.('hashchange', onHashChange);
          environment.addEventListener?.('click', onClick);
        }
        if (
          routeHistory === undefined &&
          environment.location !== undefined &&
          applicationPathname(new URL(environment.location.href).pathname) !== null
        ) {
          const { userState, key } = unwrapHistoryState(environment.history?.state ?? null);
          if (key !== null) currentHistoryKey = key;
          setLocation(
            environment.location.href,
            'replace',
            userState,
          );
        }
      }
    } catch (error) {
      disconnect();
      throw error;
    }
    let connected = true;
    return () => {
      if (!connected) return;
      connected = false;
      disconnect();
    };
  }

  function subscribe(listener: RouteListener): () => void {
    if (disposed) throw new Error('Cannot subscribe to a disposed route runtime');
    if (resolving) throw new Error('Route resolvers must not mutate router state');
    listeners.add(listener);
    try {
      listener(snapshot());
    } catch (error) {
      listeners.delete(listener);
      throw error;
    }
    return () => listeners.delete(listener);
  }

  function subscribeSelected<Value>(
    selector: RouteSelector<Value>,
    listener: RouteSelectionListener<Value>,
    equals: RouteSelectionEquality<Value> = Object.is,
  ): () => void {
    if (disposed) throw new Error('Cannot subscribe to a disposed route runtime');
    if (resolving || blocking) {
      throw new Error('Route resolvers and blockers must not mutate router state');
    }
    const subscription = {
      selector: selector as RouteSelector<unknown>,
      listener: listener as RouteSelectionListener<unknown>,
      equals: equals as RouteSelectionEquality<unknown>,
      value: selector(route),
    };
    selectedListeners.add(subscription);
    try {
      listener(subscription.value as Value, route);
    } catch (error) {
      selectedListeners.delete(subscription);
      throw error;
    }
    return () => selectedListeners.delete(subscription);
  }

  function blockNavigation(blocker: RouteNavigationBlocker): () => void {
    if (disposed) throw new Error('Cannot install a blocker on a disposed route runtime');
    if (resolving || blocking) {
      throw new Error('Route resolvers and blockers must not mutate router state');
    }
    navigationBlockers.add(blocker);
    return () => navigationBlockers.delete(blocker);
  }

  function subscribeNavigation(listener: RouteNavigationListener): () => void {
    if (disposed) throw new Error('Cannot subscribe to a disposed route runtime');
    if (resolving || blocking) {
      throw new Error('Route resolvers and blockers must not mutate router state');
    }
    navigationListeners.add(listener);
    return () => navigationListeners.delete(listener);
  }

  function installResolver(nextResolver: RouteResolver): () => void {
    if (disposed) throw new Error('Cannot install a resolver on a disposed route runtime');
    if (blocking) throw new Error('Route blockers must not mutate router state');
    if (resolver !== null) {
      throw new Error('A route runtime can only have one structural resolver');
    }
    const prepared = runResolver(nextResolver);
    resolver = nextResolver;
    if (!sameMatches(matches, prepared.matches)) {
      matches = prepared.matches;
      params = prepared.params;
      emit();
    }

    let installed = true;
    return () => {
      if (!installed) return;
      if (resolving) throw new Error('Route resolvers must not mutate router state');
      installed = false;
      if (resolver !== nextResolver) return;
      resolver = null;
      if (disposed || matches.length === 0) return;
      matches = Object.freeze([]);
      params = Object.freeze({});
      emit();
    };
  }

  function replaceResolver(nextResolver: RouteResolver): () => void {
    if (disposed) throw new Error('Cannot replace a resolver on a disposed route runtime');
    if (resolving || blocking) {
      throw new Error('Route resolvers and blockers must not mutate router state');
    }
    const prepared = runResolver(nextResolver);
    resolver = nextResolver;
    if (!sameMatches(matches, prepared.matches)) {
      matches = prepared.matches;
      params = prepared.params;
      emit();
    }

    let installed = true;
    return () => {
      if (!installed) return;
      if (resolving) throw new Error('Route resolvers must not mutate router state');
      installed = false;
      if (resolver !== nextResolver) return;
      resolver = null;
      if (disposed || matches.length === 0) return;
      matches = Object.freeze([]);
      params = Object.freeze({});
      emit();
    };
  }

  function setMatches(nextMatches: readonly RouteMatch[]): void {
    if (disposed) throw new Error('Cannot set matches on a disposed route runtime');
    if (resolving) throw new Error('Route resolvers must not mutate router state');
    if (resolver !== null) {
      throw new Error('Cannot set matches while a structural resolver is installed');
    }
    const prepared = prepareMatches(nextMatches);
    if (sameMatches(matches, prepared.matches)) return;
    matches = prepared.matches;
    params = prepared.params;
    emit();
  }

  function navigate<Path extends string>(
    pattern: Path,
    ...arguments_: NavigateArguments<Path>
  ): RouteNavigationResult {
    if (disposed) throw new Error('Cannot navigate with a disposed route runtime');
    if (resolving) throw new Error('Route resolvers must not mutate router state');
    const options = (arguments_[0] ?? {}) as NavigateOptions<Path>;
    const href = buildRoutePath(
      pattern,
      options.params,
      options.query,
      options.hash,
    );
    const next = applicationURL(href);
    return navigateToURL(next, options);
  }

  function navigateRelative<Path extends string>(
    pattern: Path,
    ...arguments_: RelativeNavigateArguments<Path>
  ): RouteNavigationResult {
    if (disposed) throw new Error('Cannot navigate with a disposed route runtime');
    if (resolving || blocking) {
      throw new Error('Route resolvers and blockers must not mutate router state');
    }
    const options = (arguments_[0] ?? {}) as RelativeNavigateOptions<Path>;
    let destination: string;
    if (
      (pattern.startsWith('?') || pattern.startsWith('#') || pattern === '') &&
      options.params === undefined &&
      options.query === undefined &&
      options.hash === undefined
    ) {
      destination = pattern;
    } else {
      destination = buildRoutePath(
        pattern,
        options.params,
        options.query,
        options.hash,
      );
      if (!pattern.startsWith('/')) destination = destination.slice(1);
    }
    const href = resolveRoutePath(options.from ?? route.pathname, destination);
    return navigateToURL(applicationURL(href), options);
  }

  function commitNavigation(
    next: URL,
    options: Pick<NavigateOptions, 'replace' | 'state'>,
  ): void {
    scrollCoordinator.capture(currentHistoryKey);
    if (!options.replace) {
      currentHistoryKey = generateHistoryKey();
    }
    if (routeHistory !== undefined) {
      const beforeNavigation = locationRevision;
      if (options.replace) routeHistory.replace(next, options.state ?? null);
      else routeHistory.push(next, options.state ?? null);
      // Custom stores are required to publish synchronously. Keep navigation
      // useful if an adapter violates that contract, without double-emitting.
      if (locationRevision === beforeNavigation) {
        setLocation(
          next,
          options.replace ? 'replace' : 'push',
          options.state ?? null,
        );
      }
      return;
    }

    const navigation = environment.navigation;
    if (navigation !== undefined) {
      const beforeNavigation = locationRevision;
      const beforeEvent = navigationEventRevision;
      committingNavigation++;
      try {
        navigation.navigate(next.href, {
          history: options.replace ? 'replace' : 'push',
          state: options.state ?? null,
        });
      } finally {
        committingNavigation--;
      }
      // A connected Navigation API dispatches `navigate` synchronously. This
      // fallback also keeps programmatic navigation useful before connection.
      if (
        navigationEventRevision === beforeEvent &&
        locationRevision === beforeNavigation
      ) {
        setLocation(
          next,
          options.replace ? 'replace' : 'push',
          options.state ?? null,
        );
      }
      return;
    }
    const history = environment.history;
    if (history !== undefined) {
      const wrapped = wrapHistoryState(options.state ?? null, currentHistoryKey);
      if (options.replace) history.replaceState(wrapped, '', next);
      else history.pushState(wrapped, '', next);
    }
    setLocation(
      next,
      options.replace ? 'replace' : 'push',
      options.state ?? null,
    );
  }

  function executePreparedNavigation(
    prepared: Extract<ReturnType<typeof prepareNavigation>, { status: 'ready' }>,
  ): RouteNavigationResult {
    const {
      next,
      options,
      navigation: routeNavigation,
      redirects,
    } = prepared;
    if (activePreparation !== null) {
      const superseded = activePreparation;
      activePreparation = null;
      superseded.abort(
        new DOMException('Route preparation was superseded', 'AbortError'),
      );
    }
    const preparation = new AbortController();
    const destinationMatches = resolveDestination(
      next,
      routeNavigation.type,
      options.state ?? null,
      preparation.signal,
    );
    if (hasRoutedPreparations(destinationMatches.matches)) {
      activePreparation = preparation;
      emitNavigation(Object.freeze({
        phase: 'prepare',
        navigation: routeNavigation,
      }));
      const finished: Promise<RouteNavigationSettledResult> = prepareRoutedMatches(
        runtime,
        destinationMatches.matches,
        {
          href: next.href,
          params: destinationMatches.params,
          signal: preparation.signal,
        },
      ).then(async outcome => {
        if (activePreparation !== preparation || preparation.signal.aborted) {
          throw preparation.signal.reason ?? new DOMException(
            'Route preparation was superseded',
            'AbortError',
          );
        }
        activePreparation = null;
        if (outcome.kind === 'redirect') {
          const redirectedPath = outcome.redirect.to instanceof URL
            ? outcome.redirect.to
            : applicationURL(resolveRoutePath(
                routeNavigation.to.pathname,
                outcome.redirect.to,
              ));
          const result = navigateToURL(redirectedPath, {
            replace: outcome.redirect.replace ?? options.replace,
            state: outcome.redirect.state ?? null,
          });
          return result.status === 'preparing' ? await result.finished : result;
        }
        commitNavigation(next, options);
        emitNavigation(Object.freeze({
          phase: 'complete',
          navigation: routeNavigation,
        }));
        return Object.freeze({
          status: 'completed' as const,
          navigation: routeNavigation,
          redirects,
        });
      }).catch(error => {
        if (activePreparation === preparation) activePreparation = null;
        if (!preparation.signal.aborted) {
          emitNavigation(Object.freeze({
            phase: 'error',
            navigation: routeNavigation,
            error,
            retry: () => navigateToURL(next, options),
          }));
        }
        throw error;
      });
      return Object.freeze({
        status: 'preparing',
        navigation: routeNavigation,
        redirects,
        finished,
      });
    }
    commitNavigation(next, options);
    emitNavigation(Object.freeze({ phase: 'complete', navigation: routeNavigation }));
    return Object.freeze({
      status: 'completed',
      navigation: routeNavigation,
      redirects,
    });
  }

  function navigateToURL(
    requested: URL,
    requestedOptions: Pick<NavigateOptions, 'replace' | 'state'>,
  ): RouteNavigationResult {
    if (disposed) throw new Error('Cannot navigate with a disposed route runtime');
    if (resolving || blocking) {
      throw new Error('Route resolvers and blockers must not mutate router state');
    }
    const prepared = prepareNavigation(requested, requestedOptions);
    return prepared.status === 'blocked'
      ? prepared
      : executePreparedNavigation(prepared);
  }

  function traverseRouteHistory(delta: -1 | 1): RouteNavigationResult | null {
    if (routeHistory === undefined) return null;
    const target = routeHistory.peek(delta);
    if (target === undefined) return null;
    const destination = new URL(target.href, url);
    const prepared = prepareNavigation(destination, {
      replace: true,
      state: target.state,
    }, 'pop');
    if (prepared.status === 'blocked') return prepared;

    const preparation = new AbortController();
    const destinationMatches = resolveDestination(
      prepared.next,
      'pop',
      target.state,
      preparation.signal,
    );
    if (hasRoutedPreparations(destinationMatches.matches)) {
      if (activePreparation !== null) {
        const superseded = activePreparation;
        activePreparation = null;
        superseded.abort(
          new DOMException('Route preparation was superseded', 'AbortError'),
        );
      }
      activePreparation = preparation;
      emitNavigation(Object.freeze({
        phase: 'prepare',
        navigation: prepared.navigation,
      }));
      const finished: Promise<RouteNavigationSettledResult> = prepareRoutedMatches(
        runtime,
        destinationMatches.matches,
        {
          href: prepared.next.href,
          params: destinationMatches.params,
          signal: preparation.signal,
        },
      ).then(async outcome => {
        if (activePreparation !== preparation || preparation.signal.aborted) {
          throw preparation.signal.reason ?? new DOMException(
            'Route preparation was superseded',
            'AbortError',
          );
        }
        activePreparation = null;
        if (outcome.kind === 'redirect') {
          const redirected = outcome.redirect.to instanceof URL
            ? outcome.redirect.to
            : applicationURL(resolveRoutePath(
                prepared.navigation.to.pathname,
                outcome.redirect.to,
              ));
          const result = navigateToURL(redirected, {
            replace: outcome.redirect.replace ?? true,
            state: outcome.redirect.state ?? null,
          });
          return result.status === 'preparing' ? await result.finished : result;
        }
        routeHistory.go(delta);
        emitNavigation(Object.freeze({
          phase: 'complete',
          navigation: prepared.navigation,
        }));
        return Object.freeze({
          status: 'completed' as const,
          navigation: prepared.navigation,
          redirects: prepared.redirects,
        });
      }).catch(error => {
        if (activePreparation === preparation) activePreparation = null;
        if (!preparation.signal.aborted) {
          emitNavigation(Object.freeze({
            phase: 'error',
            navigation: prepared.navigation,
            error,
            retry: () => traverseRouteHistory(delta)!,
          }));
        }
        throw error;
      });
      return Object.freeze({
        status: 'preparing',
        navigation: prepared.navigation,
        redirects: prepared.redirects,
        finished,
      });
    }

    if (
      prepared.navigation.type === 'pop' &&
      prepared.next.href === destination.href
    ) {
      routeHistory.go(delta);
    } else {
      commitNavigation(prepared.next, prepared.options);
    }
    emitNavigation(Object.freeze({
      phase: 'complete',
      navigation: prepared.navigation,
    }));
    return Object.freeze({
      status: 'completed',
      navigation: prepared.navigation,
      redirects: prepared.redirects,
    });
  }

  function back(): RouteNavigationResult | null {
    if (disposed) throw new Error('Cannot navigate with a disposed route runtime');
    if (resolving || blocking) {
      throw new Error('Route resolvers and blockers must not mutate router state');
    }
    if (routeHistory !== undefined) return traverseRouteHistory(-1);
    if (environment.navigation !== undefined) environment.navigation.back();
    else environment.history?.back();
    return null;
  }

  function forward(): RouteNavigationResult | null {
    if (disposed) throw new Error('Cannot navigate with a disposed route runtime');
    if (resolving || blocking) {
      throw new Error('Route resolvers and blockers must not mutate router state');
    }
    if (routeHistory !== undefined) return traverseRouteHistory(1);
    if (environment.navigation !== undefined) environment.navigation.forward();
    else environment.history?.forward();
    return null;
  }

  function dispose(): void {
    if (disposed) return;
    if (resolving || blocking) {
      throw new Error('Route resolvers and blockers must not mutate router state');
    }
    while (connectionCount > 0) disconnect();
    disconnectScroll?.();
    disconnectScroll = null;
    scrollCoordinator.dispose();
    unsubscribeRouteHistory?.();
    unsubscribeRouteHistory = null;
    disposed = true;
    activePreparation?.abort(
      new DOMException('Route runtime was disposed', 'AbortError'),
    );
    activePreparation = null;
    controller.abort();
    listeners.clear();
    selectedListeners.clear();
    navigationBlockers.clear();
    navigationListeners.clear();
    resolver = null;
    matches = Object.freeze([]);
    params = Object.freeze({});
  }

  const runtime: RouteRuntime = {
    route,
    snapshot,
    subscribe,
    subscribeSelected,
    subscribeNavigation,
    blockNavigation,
    connect,
    installResolver,
    replaceResolver,
    navigate,
    navigateRelative,
    back,
    forward,
    setLocation,
    setMatches,
    dispose,
  };
  return runtime;
}
