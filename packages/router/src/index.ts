import { defaultRouteRuntime } from './default-runtime';

export const route = defaultRouteRuntime.route;
export const navigate = defaultRouteRuntime.navigate;
export const navigateRelative = defaultRouteRuntime.navigateRelative;
export const blockNavigation = defaultRouteRuntime.blockNavigation;
export const subscribeNavigation = defaultRouteRuntime.subscribeNavigation;
export const back = defaultRouteRuntime.back;
export const forward = defaultRouteRuntime.forward;

export { createRouteRuntime, supportsNavigationAPI } from './runtime';
export { redirectRoute } from './types';
export type { RouteEnvironment, RouteRuntime, RouteRuntimeOptions } from './runtime';

export { createMemoryRouteHistory } from './history';
export { createRouteManifest } from './manifest';
export type {
  MemoryRouteHistoryEntry,
  MemoryRouteHistoryOptions,
  RouteHistory,
  RouteHistoryAction,
  RouteHistoryListener,
  RouteHistoryLocation,
  RouteHistoryUpdate,
} from './history';

export {
  buildRoutePath,
  compareRoutePatterns,
  createRouteMatcher,
  createRouteQuery,
  joinRoutePaths,
  matchRoutePattern,
  normalizeRoutePath,
  resolveRoutePath,
  parseRouteQuery,
  rankRoutePattern,
  validateRoutePattern,
  validateRoutePatterns,
} from './path';

export type {
  MatchPatternOptions,
  NavigateArguments,
  NavigateOptions,
  RelativeNavigateArguments,
  RelativeNavigateOptions,
  NavigationType,
  ParsedRouteQuery,
  PatternMatch,
  RouteLocationSnapshot,
  RouteListener,
  RouteManifest,
  RouteManifestEntry,
  RouteMatch,
  RouteNavigation,
  RouteNavigationBlocker,
  RouteNavigationDecision,
  RouteNavigationEvent,
  RouteNavigationListener,
  RouteNavigationLocation,
  RouteNavigationPhase,
  RouteNavigationResult,
  RouteRedirect,
  RouteParamValue,
  RouteParams,
  RoutePatternDefinition,
  RouteQuery,
  RouteQueryInput,
  RouteQueryValue,
  RouteSnapshot,
  RouteState,
  RouteResolver,
  RouteSelectionEquality,
  RouteSelectionListener,
  RouteSelector,
  RouteTableMatcher,
} from './types';
