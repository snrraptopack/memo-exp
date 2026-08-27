/**
 * Ambient route-runtime selection.
 *
 * The default browser experience runs on one process-wide runtime
 * (`defaultRouteRuntime`). Server rendering must instead route every read,
 * subscription, and navigation through a request-local runtime, without
 * application authors abandoning the convenient public API.
 *
 * The bridge therefore delegates through an ambient pointer: when no override
 * is active every export behaves exactly as before; a server render activates
 * a memory-history runtime for the duration of its synchronous work.
 *
 * Compiled modules install their route manifest once at module evaluation
 * (`replaceRouteResolver` at top level). That resolver is recorded here and
 * replayed onto every newly activated runtime, so each request resolves its
 * own URL against the application graph.
 */

import { createStorage } from '@memoized-dom/runtime';
import { defaultRouteRuntime } from './default-runtime';
import type { RouteRuntime } from './runtime';
import type {
  NavigateArguments,
  RelativeNavigateArguments,
  RouteListener,
  RouteNavigationBlocker,
  RouteNavigationListener,
  RouteResolver,
  RouteSelector,
  RouteSelectionEquality,
  RouteSelectionListener,
  RouteState,
} from './types';

const asyncLocalStorage = createStorage<RouteRuntime>();
let activeOverride: RouteRuntime | null = null;
let manifestResolver: RouteResolver | null = null;
const manifestApplied = new WeakSet<RouteRuntime>();

export function getActiveRouteRuntime(): RouteRuntime {
  return asyncLocalStorage.getStore() ?? activeOverride ?? defaultRouteRuntime;
}

export function runWithRouteRuntime<T>(runtime: RouteRuntime, fn: () => T): T {
  if (manifestResolver !== null && !manifestApplied.has(runtime)) {
    manifestApplied.add(runtime);
    runtime.replaceResolver(manifestResolver);
  }
  return asyncLocalStorage.run(runtime, fn);
}

/**
 * Activate a runtime for the current synchronous scope. Returns the previous
 * active runtime for restoration. Installing the recorded manifest resolver
 * is idempotent per runtime.
 */
export function setActiveRouteRuntime(
  runtime: RouteRuntime | null,
): RouteRuntime {
  const previous = getActiveRouteRuntime();
  activeOverride = runtime;
  if (
    runtime !== null &&
    manifestResolver !== null &&
    !manifestApplied.has(runtime)
  ) {
    // Compiled route manifests evaluate once per module record; replay the
    // recorded resolver so this request resolves its own location.
    runtime.replaceResolver(manifestResolver);
    manifestApplied.add(runtime);
  }
  return previous;
}

/**
 * Bridge for compiler-emitted `replaceRouteResolver` calls. Records the
 * application's structural resolver for future activations and installs it
 * on the currently active runtime.
 */
export function noteManifestResolver(resolver: RouteResolver): () => void {
  manifestResolver = resolver;
  return getActiveRouteRuntime().replaceResolver(resolver);
}

/** Getter-backed facade over whichever runtime is currently active. */
export const activeRoute: RouteState = Object.freeze({
  get href() {
    return getActiveRouteRuntime().route.href;
  },
  get pathname() {
    return getActiveRouteRuntime().route.pathname;
  },
  get search() {
    return getActiveRouteRuntime().route.search;
  },
  get query() {
    return getActiveRouteRuntime().route.query;
  },
  get hash() {
    return getActiveRouteRuntime().route.hash;
  },
  get state() {
    return getActiveRouteRuntime().route.state;
  },
  get navigationType() {
    return getActiveRouteRuntime().route.navigationType;
  },
  get params() {
    return getActiveRouteRuntime().route.params;
  },
  get matches() {
    return getActiveRouteRuntime().route.matches;
  },
  get matched() {
    return getActiveRouteRuntime().route.matched;
  },
  get signal() {
    return getActiveRouteRuntime().route.signal;
  },
});

export function navigate<Path extends string>(
  pattern: Path,
  ...arguments_: NavigateArguments<Path>
) {
  return getActiveRouteRuntime().navigate(pattern, ...arguments_);
}

export function navigateRelative<Path extends string>(
  pattern: Path,
  ...arguments_: RelativeNavigateArguments<Path>
) {
  return getActiveRouteRuntime().navigateRelative(pattern, ...arguments_);
}

export function blockNavigation(blocker: RouteNavigationBlocker): () => void {
  return getActiveRouteRuntime().blockNavigation(blocker);
}

export function subscribeNavigation(
  listener: RouteNavigationListener,
): () => void {
  return getActiveRouteRuntime().subscribeNavigation(listener);
}

export function back() {
  return getActiveRouteRuntime().back();
}

export function forward() {
  return getActiveRouteRuntime().forward();
}

export function subscribe(listener: RouteListener): () => void {
  return getActiveRouteRuntime().subscribe(listener);
}

export function subscribeSelected<Value>(
  selector: RouteSelector<Value>,
  listener: RouteSelectionListener<Value>,
  equals?: RouteSelectionEquality<Value>,
): () => void {
  return getActiveRouteRuntime().subscribeSelected(selector, listener, equals);
}

export function connect(): () => void {
  return getActiveRouteRuntime().connect();
}
