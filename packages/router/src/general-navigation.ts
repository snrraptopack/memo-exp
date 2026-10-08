import { buildRoutePath } from './path';
import { routeControlContext } from './control-context';
import type { CoreRouteRuntime, RouteRuntime } from './runtime';
import type { NavigateArguments, NavigateOptions, RouteNavigationResult } from './types';

export function enableGeneralNavigation(runtime: CoreRouteRuntime): CoreRouteRuntime & Pick<RouteRuntime, 'navigate'> {
  if ('navigate' in runtime) return runtime as CoreRouteRuntime & Pick<RouteRuntime, 'navigate'>;
  const context = routeControlContext(runtime);
  function navigate<Path extends string>(
    pattern: Path,
    ...arguments_: NavigateArguments<Path>
  ): RouteNavigationResult {
    if (context.disposed) throw new Error('Cannot navigate with a disposed route runtime');
    if (context.resolving) throw new Error('Route resolvers must not mutate router state');
    const options = (arguments_[0] ?? {}) as NavigateOptions<Path>;
    const href = buildRoutePath(
      pattern,
      options.params,
      options.query,
      options.hash,
    );
    const next = context.applicationURL(href);
    return context.navigateToURL(next, options);
  }
  return Object.assign(runtime, { navigate });
}
