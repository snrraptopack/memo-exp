import { defaultRouteRuntime } from './default-runtime';

export const route = defaultRouteRuntime.route;
export const navigate = defaultRouteRuntime.navigate;
export const back = defaultRouteRuntime.back;
export const forward = defaultRouteRuntime.forward;

export { createRouteRuntime, supportsNavigationAPI } from './runtime';
export type { RouteEnvironment, RouteRuntime } from './runtime';

export {
  buildRoutePath,
  compareRoutePatterns,
  createRouteQuery,
  joinRoutePaths,
  matchRoutePattern,
  normalizeRoutePath,
  rankRoutePattern,
  validateRoutePattern,
  validateRoutePatterns,
} from './path';

export type {
  MatchPatternOptions,
  NavigateArguments,
  NavigateOptions,
  NavigationType,
  PatternMatch,
  RouteLocationSnapshot,
  RouteListener,
  RouteMatch,
  RouteParamValue,
  RouteParams,
  RoutePatternDefinition,
  RouteQuery,
  RouteQueryInput,
  RouteQueryValue,
  RouteSnapshot,
  RouteState,
  RouteResolver,
} from './types';
