import { findRouteControlContext, routeControlContext } from './control-context';
import { validateRouteMatches } from './match-validation';
import type { CoreRouteRuntime, RouteRuntime } from './runtime';
import type { RouteMatch } from './types';

export function enableMatchValidation(runtime: CoreRouteRuntime): void {
  const context = findRouteControlContext(runtime);
  if (context !== undefined) context.prepareMatches = validateRouteMatches;
}

export function enableManualMatches(runtime: CoreRouteRuntime): CoreRouteRuntime & Pick<RouteRuntime, 'setMatches'> {
  if ('setMatches' in runtime) return runtime as CoreRouteRuntime & Pick<RouteRuntime, 'setMatches'>;
  const context = routeControlContext(runtime);
  return Object.assign(runtime, {
    setMatches(matches: readonly RouteMatch[]) {
      if (context.disposed) throw new Error('Cannot set matches on a disposed route runtime');
      if (context.resolving) throw new Error('Route resolvers must not mutate router state');
      if (context.resolver !== null) {
        throw new Error('Cannot set matches while a structural resolver is installed');
      }
      context.publishMatches(validateRouteMatches(matches));
    },
  });
}
