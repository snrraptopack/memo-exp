import { defaultRouteRuntime } from './default-runtime';

export { createRouteRuntime, supportsNavigationAPI } from './runtime';
export type {
  NavigationController,
  NavigationDestinationLike,
  NavigationEventLike,
  RouteEnvironment,
  RouteRuntime,
} from './runtime';
export type { RouteLocationSnapshot, RouteResolver } from './types';

/** Compiler-runtime boundary. Application code should not need these calls. */
export const connectRouter = defaultRouteRuntime.connect;
export const installRouteResolver = defaultRouteRuntime.installResolver;
export const subscribeRoute = defaultRouteRuntime.subscribe;
