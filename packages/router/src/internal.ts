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
import {
  invokeServerRoutedPreparation,
  prepareInitialRoutedRuntime,
  readRoutedPreparation as readPreparedValue,
  registerRoutedPreparation,
  restoreRoutedPreparationState,
  RoutedPreparationRedirectError,
  serializeRoutedPreparationState,
} from './preparation';
import type { SerializedRoutedPreparationState } from './preparation';
export type {
  RoutedServerContext,
  SerializedRoutedPreparationState,
} from './preparation';

interface RouterRuntimeBridge {
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
    ? routedBridgeExisting as RouterRuntimeBridge
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
  RouteNavigationSettledResult,
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
export {
  invokeServerRoutedPreparation,
  prepareInitialRoutedRuntime,
  registerRoutedPreparation,
  restoreRoutedPreparationState,
  RoutedPreparationRedirectError,
  serializeRoutedPreparationState,
};
export function readRoutedPreparation(id: string): unknown {
  return readPreparedValue(getActiveRouteRuntime(), id);
}

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
