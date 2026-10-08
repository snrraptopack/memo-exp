import { assertRouteControlMutation, disposeRouteControl, routeControlContext } from './control-context';
import type { CoreRouteRuntime, RouteRuntime } from './runtime';
import type { RouteNavigationEvent, RouteNavigationListener } from './types';

export function enableNavigationObservers(runtime: CoreRouteRuntime): CoreRouteRuntime & Pick<RouteRuntime, 'subscribeNavigation'> {
  if ('subscribeNavigation' in runtime) return runtime as CoreRouteRuntime & Pick<RouteRuntime, 'subscribeNavigation'>;
  const context = routeControlContext(runtime);
  const navigationListeners = new Set<RouteNavigationListener>();
  function emitNavigation(event: RouteNavigationEvent): void {
    const errors: unknown[] = [];
    for (const listener of [...navigationListeners]) {
      if (!navigationListeners.has(listener)) continue;
      try {
        listener(event);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Route navigation listeners failed');
    }
  }
  context.emit = emitNavigation;
  disposeRouteControl(context, () => navigationListeners.clear());
  return Object.assign(runtime, {
    subscribeNavigation(listener: RouteNavigationListener) {
      assertRouteControlMutation(context, 'Cannot subscribe to a disposed route runtime');
      navigationListeners.add(listener);
      return () => navigationListeners.delete(listener);
    },
  });
}
