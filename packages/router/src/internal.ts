import type { RouteRuntime } from './runtime';
import type {
  RouteNavigationBlocker as Blocker,
  RouteResolver,
  RouteState,
} from './types';
import {
  activeRoute,
  connect as activeConnect,
  getActiveRouteRuntime,
  navigate as activeNavigate,
  navigateRelative as activeNavigateRelative,
  noteManifestResolver,
  subscribe as activeSubscribe,
  subscribeNavigation as activeSubscribeNavigation,
  subscribeSelected as activeSubscribeSelected,
} from './active-runtime';

export const route = activeRoute;
export const navigateRoute = activeNavigate;

export { createRouteRuntime, supportsNavigationAPI } from './runtime';
export { redirectRoute } from './types';
export { createRouteManifest } from './manifest';
export type {
  NavigationController,
  NavigationDestinationLike,
  NavigationEventLike,
  RouteEnvironment,
  RouteRuntime,
} from './runtime';
export type {
  RouteLocationSnapshot,
  RouteNavigation,
  RouteNavigationBlocker,
  RouteNavigationEvent,
  RouteNavigationListener,
  RouteNavigationResult,
  RouteResolver,
} from './types';
export { createMemoryRouteHistory } from './history';
export type { RouteHistory } from './history';
export { buildRoutePath } from './path';

/** Compiler-runtime boundary. Application code should not need these calls. */
export const connectRouter = (): (() => void) => activeConnect();
const connections = new WeakMap<RouteRuntime, () => void>();
export function ensureRouterConnected(): void {
  const runtime = getActiveRouteRuntime();
  if (!connections.has(runtime)) connections.set(runtime, runtime.connect());
}
export function installRouteResolver(resolver: RouteResolver): () => void {
  return getActiveRouteRuntime().installResolver(resolver);
}
export function replaceRouteResolver(resolver: RouteResolver): () => void {
  return noteManifestResolver(resolver);
}
export const navigateRouteRelative = activeNavigateRelative;
export function blockRouteNavigation(blocker: Blocker): () => void {
  return getActiveRouteRuntime().blockNavigation(blocker);
}
export const subscribeRouteNavigation = activeSubscribeNavigation;
export const subscribeRoute = activeSubscribe;
export const subscribeRouteSelected = activeSubscribeSelected;

/** Subscribe to navigation changes without treating subscription setup as one. */
export function subscribeRouteValue(
  _value: RouteState,
  listener: () => void,
): () => void {
  let initialized = false;
  return activeSubscribe(() => {
    if (!initialized) {
      initialized = true;
      return;
    }
    listener();
  });
}
