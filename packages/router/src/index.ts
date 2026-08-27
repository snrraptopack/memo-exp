import type {
  NavigateArguments,
  RelativeNavigateArguments,
  RouteNavigationBlocker,
  RouteNavigationListener,
} from './types';
import {
  activeRoute,
  back as activeBack,
  forward as activeForward,
  getActiveRouteRuntime,
} from './active-runtime';

export const route = activeRoute;
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
  return activeBack();
}
export function forward() {
  return activeForward();
}
export { getActiveRouteRuntime, setActiveRouteRuntime, runWithRouteRuntime } from './active-runtime';

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
