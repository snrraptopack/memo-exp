import { routeControlContext, disposeRouteControl } from './control-context';
import type { CoreRouteRuntime, RouteRuntime } from './runtime';
import type { RouteListener, RouteSnapshot } from './types';

/** Snapshot subscriptions share the engine's selected-listener publication loop. */
export function enableRouteSnapshots(runtime: CoreRouteRuntime): CoreRouteRuntime & Pick<RouteRuntime, 'snapshot' | 'subscribe'> {
  if ('snapshot' in runtime && 'subscribe' in runtime) return runtime as CoreRouteRuntime & Pick<RouteRuntime, 'snapshot' | 'subscribe'>;
  const context = routeControlContext(runtime);
  const listeners = new Set<RouteListener>();
  function snapshot(): RouteSnapshot {
    return Object.freeze({
      href: runtime.route.href,
      pathname: runtime.route.pathname,
      search: runtime.route.search,
      query: runtime.route.query,
      hash: runtime.route.hash,
      state: runtime.route.state,
      navigationType: runtime.route.navigationType,
      params: runtime.route.params,
      matches: runtime.route.matches,
      matched: runtime.route.matched,
      signal: runtime.route.signal,
    });
  }
  function notifySnapshots(errors: unknown[], emittedRevision: number): void {
    const value = snapshot();
    // Keep a snapshot: callbacks may unsubscribe while publication is active.
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try {
        listener(value);
      } catch (error) {
        errors.push(error);
      }
      if (context.revision !== emittedRevision) break;
    }
  }
  function remove(listener: RouteListener): boolean {
    const removed = listeners.delete(listener);
    if (listeners.size === 0) context.notifySnapshots = undefined;
    return removed;
  }
  disposeRouteControl(context, () => { listeners.clear(); context.notifySnapshots = undefined; });
  return Object.assign(runtime, {
    snapshot,
    subscribe(listener: RouteListener) {
      if (context.disposed) throw new Error('Cannot subscribe to a disposed route runtime');
      if (context.resolving) throw new Error('Route resolvers must not mutate router state');
      listeners.add(listener);
      context.notifySnapshots = notifySnapshots;
      try { listener(snapshot()); } catch (error) { remove(listener); throw error; }
      return () => remove(listener);
    },
  });
}
