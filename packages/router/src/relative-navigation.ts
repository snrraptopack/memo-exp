import { buildRoutePath, resolveRoutePath } from './path';
import { routeControlContext } from './control-context';
import type { CoreRouteRuntime, RouteRuntime } from './runtime';
import type { RelativeNavigateArguments, RelativeNavigateOptions, RouteNavigationResult } from './types';

export function enableRelativeNavigation(runtime: CoreRouteRuntime): CoreRouteRuntime & Pick<RouteRuntime, 'navigateRelative'> {
  if ('navigateRelative' in runtime) return runtime as CoreRouteRuntime & Pick<RouteRuntime, 'navigateRelative'>;
  const context = routeControlContext(runtime);
  function navigateRelative<Path extends string>(
    pattern: Path,
    ...arguments_: RelativeNavigateArguments<Path>
  ): RouteNavigationResult {
    if (context.disposed) throw new Error('Cannot navigate with a disposed route runtime');
    if (context.resolving || context.blocking) {
      throw new Error('Route resolvers and blockers must not mutate router state');
    }
    const options = (arguments_[0] ?? {}) as RelativeNavigateOptions<Path>;
    let destination: string;
    if (
      (pattern.startsWith('?') || pattern.startsWith('#') || pattern === '') &&
      options.params === undefined &&
      options.query === undefined &&
      options.hash === undefined
    ) {
      destination = pattern;
    } else {
      destination = buildRoutePath(
        pattern,
        options.params,
        options.query,
        options.hash,
      );
      if (!pattern.startsWith('/')) destination = destination.slice(1);
    }
    const href = resolveRoutePath(options.from ?? runtime.route.pathname, destination);
    return context.navigateToURL(context.applicationURL(href), options);
  }
  return Object.assign(runtime, { navigateRelative });
}
