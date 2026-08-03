import { defaultRouteRuntime } from './default-runtime';

export { createRouteRuntime, supportsNavigationAPI } from './runtime';
export type {
  NavigationController,
  NavigationDestinationLike,
  NavigationEventLike,
  RouteEnvironment,
  RouteRuntime,
} from './runtime';

/** Compiler-runtime boundary. Application code should not need these calls. */
export const connectRouter = defaultRouteRuntime.connect;
export const subscribeRoute = defaultRouteRuntime.subscribe;
export const setRouteMatches = defaultRouteRuntime.setMatches;
export const setRouteLocation = defaultRouteRuntime.setLocation;
