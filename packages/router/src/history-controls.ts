import { hasRoutedPreparations } from './preparation-capability';
import { routeControlContext } from './control-context';
import type { CoreRouteRuntime, RouteRuntime } from './runtime';
import type { RouteNavigationResult } from './types';

export function enableHistoryControls(runtime: CoreRouteRuntime): CoreRouteRuntime & Pick<RouteRuntime, 'back' | 'forward'> {
  if ('back' in runtime && 'forward' in runtime) return runtime as CoreRouteRuntime & Pick<RouteRuntime, 'back' | 'forward'>;
  const context = routeControlContext(runtime);
  const history = context.history;
  function traverseRouteHistory(delta: -1 | 1): RouteNavigationResult | null {
    if (history === undefined) return null;
    const target = history.peek(delta);
    if (target === undefined) return null;
    const destination = new URL(target.href, context.url);
    const prepared = context.prepareNavigation(destination, {
      replace: true,
      state: target.state,
    }, 'pop');
    if (prepared.status === 'blocked') return prepared;

    context.supersedePreparation();
    if (prepared.next.href !== destination.href) return context.executePreparedNavigation(prepared);

    const preparation = new AbortController();
    const destinationMatches = context.resolveDestination(
      prepared.next,
      'pop',
      target.state,
      preparation.signal,
    );
    if (!context.isHashOnlyDestination(prepared.next, target.state) && hasRoutedPreparations(destinationMatches.matches)) {
      let entryCommitted = false;
      return context.prepareRouteEntry(prepared, destinationMatches, preparation, () => {
        history.go(delta);
        entryCommitted = true;
        return context.finishNavigation(prepared.navigation, prepared.redirects, preparation, true);
      }, error => {
        if (!entryCommitted && !preparation.signal.aborted && context.navigationId === prepared.navigation.id) {
          context.emit?.(Object.freeze({
            phase: 'error',
            navigation: prepared.navigation,
            error,
            retry: () => {
              if (
                context.disposed || context.navigationId !== prepared.navigation.id ||
                history.peek(delta)?.key !== target.key
              ) {
                return Object.freeze({
                  status: 'blocked', navigation: prepared.navigation, redirects: prepared.redirects,
                });
              }
              return traverseRouteHistory(delta)!;
            },
          }));
        }
      });
    }

    if (
      prepared.navigation.type === 'pop' &&
      prepared.next.href === destination.href
    ) {
      history.go(delta);
    } else {
      context.commitNavigation(prepared.next, prepared.options);
    }
    return context.finishNavigation(prepared.navigation, prepared.redirects);
  }

  function back(): RouteNavigationResult | null {
    if (context.disposed) throw new Error('Cannot navigate with a disposed route runtime');
    if (context.resolving || context.blocking) {
      throw new Error('Route resolvers and blockers must not mutate router state');
    }
    if (history !== undefined) return traverseRouteHistory(-1);
    if (context.environment.navigation !== undefined) context.environment.navigation.back();
    else context.environment.history?.back();
    return null;
  }

  function forward(): RouteNavigationResult | null {
    if (context.disposed) throw new Error('Cannot navigate with a disposed route runtime');
    if (context.resolving || context.blocking) {
      throw new Error('Route resolvers and blockers must not mutate router state');
    }
    if (history !== undefined) return traverseRouteHistory(1);
    if (context.environment.navigation !== undefined) context.environment.navigation.forward();
    else context.environment.history?.forward();
    return null;
  }
  return Object.assign(runtime, { back, forward });
}
