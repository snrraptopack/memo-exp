import { resolveRoutePath } from './path';
import { assertRouteControlMutation, disposeRouteControl, routeControlContext } from './control-context';
import type { CoreRouteRuntime, RouteRuntime } from './runtime';

export function enableNavigationBlockers(runtime: CoreRouteRuntime): CoreRouteRuntime & Pick<RouteRuntime, 'blockNavigation'> {
  if ('blockNavigation' in runtime) return runtime as CoreRouteRuntime & Pick<RouteRuntime, 'blockNavigation'>;
  const context = routeControlContext(runtime);
  const blockers = new Set<Parameters<RouteRuntime['blockNavigation']>[0]>();
  disposeRouteControl(context, () => blockers.clear());
  context.prepare = initial => {
    const { id, from } = initial.navigation;
    let next = initial.next;
    let nextOptions = initial.options;
    let nextType = initial.navigation.type;
    let redirects = 0;
    while (true) {
      const navigation = redirects === 0 ? initial.navigation
        : context.navigationRecord(id, from, next, nextOptions, nextType);
      let redirected = false;
      context.blocking = true;
      try {
        for (const blocker of [...blockers]) {
          if (!blockers.has(blocker)) continue;
          const decision = blocker(navigation);
          if (
            typeof decision === 'object' &&
            decision !== null &&
            'then' in decision
          ) {
            throw new TypeError(
              'Route navigation blockers must be synchronous; async work belongs to the data boundary',
            );
          }
          if (decision === false) {
            context.emit?.(Object.freeze({ phase: 'blocked', navigation }));
            return Object.freeze({ status: 'blocked', navigation, redirects });
          }
          if (typeof decision === 'object' && decision !== null && 'to' in decision) {
            redirects++;
            if (redirects > 16) {
              throw new Error('Route navigation exceeded 16 redirects');
            }
            context.emit?.(Object.freeze({
              phase: 'redirect',
              navigation,
              redirect: decision,
            }));
            if (decision.to instanceof URL) {
              next = new URL(decision.to.href);
            } else {
              const redirectedPath = resolveRoutePath(
                navigation.to.pathname,
                decision.to,
              );
              next = context.applicationURL(redirectedPath);
            }
            nextOptions = {
              replace: decision.replace ?? nextOptions.replace,
              state: decision.state ?? null,
            };
            nextType = nextOptions.replace ? 'replace' : 'push';
            redirected = true;
            break;
          }
        }
      } finally {
        context.blocking = false;
      }
      if (!redirected) {
        return {
          status: 'ready',
          next,
          options: nextOptions,
          navigation,
          redirects,
        };
      }
    }
  };
  return Object.assign(runtime, {
    blockNavigation(blocker: Parameters<RouteRuntime['blockNavigation']>[0]) {
      assertRouteControlMutation(context, 'Cannot install a blocker on a disposed route runtime');
      blockers.add(blocker);
      return () => blockers.delete(blocker);
    },
  });
}
