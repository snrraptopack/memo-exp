import { buildRoutePath, validateRoutePattern } from './path';
import type {
  NavigateOptions,
  NavigateArguments,
  NavigationType,
  RouteListener,
  RouteLocationSnapshot,
  RouteMatch,
  RouteQuery,
  RouteResolver,
  RouteSnapshot,
  RouteState,
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
  connect(): () => void;
  installResolver(resolver: RouteResolver): () => void;
  navigate<Path extends string>(
    pattern: Path,
    ...arguments_: NavigateArguments<Path>
  ): void;
  back(): void;
  forward(): void;
  setLocation(href: string | URL, type?: NavigationType, state?: unknown): void;
  setMatches(matches: readonly RouteMatch[]): void;
  dispose(): void;
}

export function supportsNavigationAPI(
  environment: RouteEnvironment = typeof window === 'undefined' ? {} : window,
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

function readonlyQuery(search: string): RouteQuery {
  const params = new URLSearchParams(search);
  let query: RouteQuery;
  query = Object.freeze({
    get size() { return params.size; },
    get: params.get.bind(params),
    getAll: params.getAll.bind(params),
    has: params.has.bind(params),
    entries: params.entries.bind(params),
    keys: params.keys.bind(params),
    values: params.values.bind(params),
    forEach(
      callback: (value: string, key: string, query: RouteQuery) => void,
      thisArg?: unknown,
    ) {
      params.forEach((value, key) => callback.call(thisArg, value, key, query));
    },
    toString: params.toString.bind(params),
    [Symbol.iterator]: params[Symbol.iterator].bind(params),
  });
  return query;
}

function prepareMatches(nextMatches: readonly RouteMatch[]): {
  readonly matches: readonly RouteMatch[];
  readonly params: Readonly<Record<string, string>>;
} {
  const identifiers = new Set<string>();
  const merged: Record<string, string> = {};
  const frozen = nextMatches.map(match => {
    if (match.id.trim() === '') throw new TypeError('Route match IDs must not be empty');
    if (identifiers.has(match.id)) {
      throw new TypeError(`Duplicate active route ID '${match.id}'`);
    }
    identifiers.add(match.id);
    validateRoutePattern(match.pattern);
    for (const [key, value] of Object.entries(match.params)) {
      if (Object.hasOwn(merged, key)) {
        throw new TypeError(`Duplicate active route parameter '${key}'`);
      }
      merged[key] = value;
    }
    return frozenMatch(match);
  });
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

export function createRouteRuntime(
  environment: RouteEnvironment = typeof window === 'undefined' ? {} : window,
): RouteRuntime {
  let url = initialURL(environment);
  let state: unknown = environment.history?.state ?? null;
  let navigationType: NavigationType = 'load';
  let matches: readonly RouteMatch[] = Object.freeze([]);
  let params: Readonly<Record<string, string>> = Object.freeze({});
  let query = readonlyQuery(url.search);
  let controller = new AbortController();
  let connectionCount = 0;
  let disposed = false;
  let resolver: RouteResolver | null = null;
  let resolving = false;
  let revision = 0;
  let locationRevision = 0;
  let navigationEventRevision = 0;
  let emitting = false;
  let emissionPending = false;
  const listeners = new Set<RouteListener>();

  const route: RouteState = Object.freeze({
    get href() { return url.href; },
    get pathname() { return url.pathname; },
    get search() { return url.search; },
    get query() { return query; },
    get hash() { return url.hash; },
    get state() { return state; },
    get navigationType() { return navigationType; },
    get params() { return params; },
    get matches() { return matches; },
    get matched() { return matches.at(-1) ?? null; },
    get signal() { return controller.signal; },
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
      href: route.href,
      pathname: route.pathname,
      search: route.search,
      query: route.query,
      hash: route.hash,
      state: route.state,
      navigationType: route.navigationType,
      signal: route.signal,
    });
  }

  function emit(): void {
    revision++;
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

  function setLocation(
    href: string | URL,
    type: NavigationType = 'replace',
    nextState: unknown = null,
  ): void {
    if (disposed) throw new Error('Cannot set location on a disposed route runtime');
    if (resolving) throw new Error('Route resolvers must not mutate router state');
    const next = new URL(href, url);
    const changed = next.href !== url.href || !Object.is(nextState, state);
    if (!changed) return;

    const previousURL = url;
    const previousState = state;
    const previousNavigationType = navigationType;
    const previousQuery = query;
    const previousController = controller;
    const nextController = new AbortController();
    url = next;
    state = nextState;
    navigationType = type;
    controller = nextController;
    query = readonlyQuery(url.search);
    let prepared: ReturnType<typeof prepareMatches>;
    try {
      prepared = resolver === null ? prepareMatches([]) : runResolver(resolver);
    } catch (error) {
      url = previousURL;
      state = previousState;
      navigationType = previousNavigationType;
      query = previousQuery;
      controller = previousController;
      nextController.abort();
      throw error;
    }
    matches = prepared.matches;
    params = prepared.params;
    previousController.abort();
    locationRevision++;
    emit();
  }

  const onPopState: EventListener = () => {
    const location = environment.location;
    if (location !== undefined) {
      setLocation(location.href, 'pop', environment.history?.state ?? null);
    }
  };

  const onHashChange: EventListener = () => {
    const location = environment.location;
    if (location !== undefined && location.href !== url.href) {
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
    if (destination.origin !== url.origin) return;
    const type: NavigationType = navigationEvent.navigationType === 'traverse'
      ? 'pop'
      : navigationEvent.navigationType === 'push'
        ? 'push'
        : 'replace';
    const destinationState = navigationEvent.destination.getState?.() ?? null;

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
    if (supportsNavigationAPI(environment)) {
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
        if (supportsNavigationAPI(environment)) {
          environment.navigation!.addEventListener('navigate', onNavigate);
        } else {
          environment.addEventListener?.('popstate', onPopState);
          environment.addEventListener?.('hashchange', onHashChange);
          environment.addEventListener?.('click', onClick);
        }
        if (environment.location !== undefined) {
          setLocation(
            environment.location.href,
            'replace',
            environment.history?.state ?? null,
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

  function installResolver(nextResolver: RouteResolver): () => void {
    if (disposed) throw new Error('Cannot install a resolver on a disposed route runtime');
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
  ): void {
    if (disposed) throw new Error('Cannot navigate with a disposed route runtime');
    if (resolving) throw new Error('Route resolvers must not mutate router state');
    const options = (arguments_[0] ?? {}) as NavigateOptions<Path>;
    const href = buildRoutePath(
      pattern,
      options.params,
      options.query,
      options.hash,
    );
    const next = new URL(href, url);
    navigateToURL(next, options);
  }

  function navigateToURL(
    next: URL,
    options: Pick<NavigateOptions, 'replace' | 'state'>,
  ): void {
    if (disposed) throw new Error('Cannot navigate with a disposed route runtime');
    const navigation = environment.navigation;
    if (navigation !== undefined) {
      const beforeNavigation = locationRevision;
      const beforeEvent = navigationEventRevision;
      navigation.navigate(next.href, {
        history: options.replace ? 'replace' : 'push',
        state: options.state ?? null,
      });
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
      if (options.replace) history.replaceState(options.state ?? null, '', next);
      else history.pushState(options.state ?? null, '', next);
    }
    setLocation(
      next,
      options.replace ? 'replace' : 'push',
      options.state ?? null,
    );
  }

  function back(): void {
    if (disposed) throw new Error('Cannot navigate with a disposed route runtime');
    if (resolving) throw new Error('Route resolvers must not mutate router state');
    if (environment.navigation !== undefined) environment.navigation.back();
    else environment.history?.back();
  }

  function forward(): void {
    if (disposed) throw new Error('Cannot navigate with a disposed route runtime');
    if (resolving) throw new Error('Route resolvers must not mutate router state');
    if (environment.navigation !== undefined) environment.navigation.forward();
    else environment.history?.forward();
  }

  function dispose(): void {
    if (disposed) return;
    if (resolving) throw new Error('Route resolvers must not mutate router state');
    while (connectionCount > 0) disconnect();
    disposed = true;
    controller.abort();
    listeners.clear();
    resolver = null;
    matches = Object.freeze([]);
    params = Object.freeze({});
  }

  return {
    route,
    snapshot,
    subscribe,
    connect,
    installResolver,
    navigate,
    back,
    forward,
    setLocation,
    setMatches,
    dispose,
  };
}
