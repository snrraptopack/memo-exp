import type { RouteRuntime } from './runtime';
import type {
  RouteNavigationBlocker as Blocker,
  RouteResolver,
  RouteState,
  RouteSelector,
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
  prepareInitialRouteModules as prepareInitialModules,
  readRouteModuleState,
  readRouteComponent,
  registerRouteComponent,
  subscribeRouteModuleState,
  readRoutedPreparation as readPreparedValue,
  registerRoutedPreparation,
  restoreRoutedPreparationState,
  RoutedPreparationRedirectError,
  serializeRoutedPreparationState,
} from './preparation';
import type { SerializedRoutedPreparationState } from './preparation';
export type {
  RouteModuleListener,
  RouteModuleState,
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
export { routeRegionIdentity } from './region-identity';
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
  readRouteComponent,
  readRouteModuleState,
  registerRouteComponent,
  subscribeRouteModuleState,
};
export function prepareInitialRouteModules(): Promise<void> {
  return prepareInitialModules(getActiveRouteRuntime());
}
/** Load and prepare before a fresh client mount; SSR already delivered its data. */
export async function prepareInitialRoute(): Promise<void> {
  const runtime = getActiveRouteRuntime();
  // Adoption normally restores this at mount(). Entry preparation happens
  // earlier, so deliver only the routed envelope now to avoid running gates twice.
  if (typeof document !== 'undefined') {
    const script = document.querySelector('script[type="application/mmd+json"][data-mmd-root]');
    if (script?.textContent) {
      try {
        const payload = JSON.parse(script.textContent);
        if (payload?.version === 1 && payload.routed !== undefined) {
          restoreRoutedPreparationState(runtime, payload.routed);
        }
      } catch {
        // Malformed payloads cannot substitute for actual preparation.
      }
    }
  }
  const outcome = await prepareInitialRoutedRuntime(runtime, { reusePrepared: true });
  if (outcome.kind === 'redirect') {
    const result = runtime.navigate(outcome.redirect.to.toString(), {
      replace: outcome.redirect.replace ?? true,
      state: outcome.redirect.state ?? null,
    });
    const settled = result.status === 'preparing' ? await result.finished : result;
    if (settled.status === 'blocked') {
      throw new RoutedPreparationRedirectError(outcome.redirect);
    }
  }
}
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

/** Selected component reads skip the subscription's initial notification. */
export function subscribeRouteSelectedValue<Value>(
  selector: RouteSelector<Value>,
  listener: () => void,
): () => void {
  let initialized = false;
  return activeSubscribeSelected(selector, () => {
    if (!initialized) {
      initialized = true;
      return;
    }
    listener();
  });
}
