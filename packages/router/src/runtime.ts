import { buildRoutePath } from './path';
import type {
  NavigateOptions,
  NavigateArguments,
  NavigationType,
  RouteListener,
  RouteMatch,
  RouteSnapshot,
  RouteState,
} from './types';

const FALLBACK_ORIGIN = 'http://memoized-dom.local';

export interface RouteEnvironment {
  readonly location?: Location;
  readonly history?: History;
  readonly navigation?: NavigationController;
  addEventListener?(
    type: 'popstate' | 'hashchange',
    listener: EventListener,
  ): void;
  removeEventListener?(
    type: 'popstate' | 'hashchange',
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
  let query = new URLSearchParams(url.search);
  let controller = new AbortController();
  let connectionCount = 0;
  let disposed = false;
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
      query: new URLSearchParams(route.search),
      hash: route.hash,
      state: route.state,
      navigationType: route.navigationType,
      params: route.params,
      matches: route.matches,
      matched: route.matched,
      signal: route.signal,
    });
  }

  function emit(): void {
    const value = snapshot();
    for (const listener of listeners) listener(value);
  }

  function setLocation(
    href: string | URL,
    type: NavigationType = 'replace',
    nextState: unknown = null,
  ): void {
    const next = new URL(href, url);
    const changed = next.href !== url.href || !Object.is(nextState, state);
    if (!changed) return;

    navigationType = type;
    controller.abort();
    controller = new AbortController();
    url = next;
    state = nextState;
    query = new URLSearchParams(url.search);
    matches = Object.freeze([]);
    params = Object.freeze({});
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

  const onNavigate: EventListener = event => {
    const navigationEvent = event as NavigationEventLike;
    if (
      !navigationEvent.canIntercept ||
      navigationEvent.downloadRequest
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
      scroll: 'manual',
      async handler() {
        // Route subscribers render from the synchronous location update.
        // Yielding here lets their microtask commit settle before navigation
        // success and the browser's post-navigation behavior run.
        await Promise.resolve();
      },
    });
  };

  function disconnect(): void {
    if (connectionCount === 0) return;
    connectionCount--;
    if (connectionCount !== 0) return;
    if (supportsNavigationAPI(environment)) {
      environment.navigation!.removeEventListener('navigate', onNavigate);
    } else {
      environment.removeEventListener?.('popstate', onPopState);
      environment.removeEventListener?.('hashchange', onHashChange);
    }
  }

  function connect(): () => void {
    if (disposed) throw new Error('Cannot connect a disposed route runtime');
    connectionCount++;
    if (connectionCount === 1) {
      if (supportsNavigationAPI(environment)) {
        environment.navigation!.addEventListener('navigate', onNavigate);
      } else {
        environment.addEventListener?.('popstate', onPopState);
        environment.addEventListener?.('hashchange', onHashChange);
      }
      if (environment.location !== undefined) {
        setLocation(
          environment.location.href,
          'replace',
          environment.history?.state ?? null,
        );
      }
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
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  function setMatches(nextMatches: readonly RouteMatch[]): void {
    if (sameMatches(matches, nextMatches)) return;
    const frozen = nextMatches.map(frozenMatch);
    const merged: Record<string, string> = {};
    for (const match of frozen) Object.assign(merged, match.params);
    matches = Object.freeze(frozen);
    params = Object.freeze(merged);
    emit();
  }

  function navigate<Path extends string>(
    pattern: Path,
    ...arguments_: NavigateArguments<Path>
  ): void {
    if (disposed) throw new Error('Cannot navigate with a disposed route runtime');
    const options = (arguments_[0] ?? {}) as NavigateOptions<Path>;
    const href = buildRoutePath(
      pattern,
      options.params,
      options.query,
      options.hash,
    );
    const next = new URL(href, url);
    const navigation = environment.navigation;
    if (navigation !== undefined) {
      navigation.navigate(next.href, {
        history: options.replace ? 'replace' : 'push',
        state: options.state ?? null,
      });
      // A connected Navigation API dispatches `navigate` synchronously. This
      // fallback also keeps programmatic navigation useful before connection.
      if (next.href !== url.href) {
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
    if (environment.navigation !== undefined) environment.navigation.back();
    else environment.history?.back();
  }

  function forward(): void {
    if (environment.navigation !== undefined) environment.navigation.forward();
    else environment.history?.forward();
  }

  function dispose(): void {
    if (disposed) return;
    while (connectionCount > 0) disconnect();
    disposed = true;
    controller.abort();
    listeners.clear();
    matches = Object.freeze([]);
    params = Object.freeze({});
  }

  return {
    route,
    snapshot,
    subscribe,
    connect,
    navigate,
    back,
    forward,
    setLocation,
    setMatches,
    dispose,
  };
}
