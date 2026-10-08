/** Private access to the shared engine for separately reachable public controls. */
import type { CoreRouteRuntime, RouteEnvironment } from './runtime';
import type { RouteHistory } from './history';
import type {
  NavigateOptions, NavigationType, RouteMatch, RouteNavigation,
  RouteNavigationEvent, RouteNavigationLocation, RouteNavigationResult,
  RouteResolver,
} from './types';

export interface PreparedRouteNavigation {
  readonly status: 'ready';
  readonly next: URL;
  readonly options: Pick<NavigateOptions, 'replace' | 'state'>;
  readonly navigation: RouteNavigation;
  readonly redirects: number;
}

export type RouteNavigationPreparation = PreparedRouteNavigation |
  Extract<RouteNavigationResult, { status: 'blocked' }>;

export interface PreparedRouteMatches {
  readonly matches: readonly RouteMatch[];
  readonly params: Readonly<Record<string, string>>;
}

export interface RouteControlContext {
  readonly environment: RouteEnvironment;
  readonly history: RouteHistory | undefined;
  readonly disposed: boolean;
  readonly resolving: boolean;
  blocking: boolean;
  readonly resolver: RouteResolver | null;
  readonly navigationId: number;
  readonly revision: number;
  notifySnapshots?: (errors: unknown[], emittedRevision: number) => void;
  readonly url: URL;
  prepare?: (initial: PreparedRouteNavigation) => RouteNavigationPreparation;
  emit?: (event: RouteNavigationEvent) => void;
  dispose?: () => void;
  prepareMatches(matches: readonly RouteMatch[]): PreparedRouteMatches;
  publishMatches(matches: PreparedRouteMatches): void;
  applicationURL(href: string): URL;
  publishResolver(resolver: RouteResolver): () => void;
  navigationRecord(id: number, from: RouteNavigationLocation, next: URL,
    options: PreparedRouteNavigation['options'], type: Exclude<NavigationType, 'load'>): RouteNavigation;
  navigateToURL(next: URL, options: PreparedRouteNavigation['options']): RouteNavigationResult;
  prepareNavigation(next: URL, options: PreparedRouteNavigation['options'],
    type?: Exclude<NavigationType, 'load'>): RouteNavigationPreparation;
  supersedePreparation(): void;
  executePreparedNavigation(prepared: PreparedRouteNavigation): RouteNavigationResult;
  resolveDestination(next: URL, type: NavigationType, state: unknown, signal: AbortSignal): PreparedRouteMatches;
  isHashOnlyDestination(next: URL, state: unknown): boolean;
  prepareRouteEntry(prepared: PreparedRouteNavigation, matches: PreparedRouteMatches,
    preparation: AbortController, publish: () => RouteNavigationResult,
    failed: (error: unknown) => void): RouteNavigationResult;
  finishNavigation(navigation: RouteNavigation, redirects: number,
    preparation?: AbortController, preparingAlready?: boolean): RouteNavigationResult;
  commitNavigation(next: URL, options: PreparedRouteNavigation['options']): void;
}

const contexts = new WeakMap<CoreRouteRuntime, RouteControlContext>();

export function registerRouteControlContext(runtime: CoreRouteRuntime, context: RouteControlContext): void {
  contexts.set(runtime, context);
}

export function routeControlContext(runtime: CoreRouteRuntime): RouteControlContext {
  const context = contexts.get(runtime);
  if (context === undefined) throw new Error('Route controls require a registered route engine');
  return context;
}

/** Foreign public engines implement their own validation. */
export function findRouteControlContext(runtime: CoreRouteRuntime): RouteControlContext | undefined {
  return contexts.get(runtime);
}

export function assertRouteControlMutation(context: RouteControlContext, disposedMessage: string): void {
  if (context.disposed) throw new Error(disposedMessage);
  if (context.resolving || context.blocking) {
    throw new Error('Route resolvers and blockers must not mutate router state');
  }
}

export function disposeRouteControl(context: RouteControlContext, dispose: () => void): void {
  const previous = context.dispose;
  context.dispose = () => { previous?.(); dispose(); };
}
