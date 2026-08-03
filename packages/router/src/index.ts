import { defaultRouteRuntime } from './default-runtime';

export const route = defaultRouteRuntime.route;
export const navigate = defaultRouteRuntime.navigate;
export const back = defaultRouteRuntime.back;
export const forward = defaultRouteRuntime.forward;

export { supportsNavigationAPI } from './runtime';

export {
  buildRoutePath,
  createRouteQuery,
  joinRoutePaths,
  matchRoutePattern,
  normalizeRoutePath,
  rankRoutePattern,
} from './path';

export type {
  MatchPatternOptions,
  NavigateArguments,
  NavigateOptions,
  NavigationType,
  PatternMatch,
  RouteListener,
  RouteMatch,
  RouteParamValue,
  RouteParams,
  RouteQueryInput,
  RouteQueryValue,
  RouteSnapshot,
  RouteState,
} from './types';
