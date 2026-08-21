import { defaultRouteRuntime } from './default-runtime';

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

/** Compiler-runtime boundary. Application code should not need these calls. */
export const connectRouter = defaultRouteRuntime.connect;
export const installRouteResolver = defaultRouteRuntime.installResolver;
export const replaceRouteResolver = defaultRouteRuntime.replaceResolver;
export const navigateRouteRelative = defaultRouteRuntime.navigateRelative;
export const blockRouteNavigation = defaultRouteRuntime.blockNavigation;
export const subscribeRouteNavigation = defaultRouteRuntime.subscribeNavigation;
export const subscribeRoute = defaultRouteRuntime.subscribe;
export const subscribeRouteSelected = defaultRouteRuntime.subscribeSelected;
