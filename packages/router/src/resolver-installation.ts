import { routeControlContext } from './control-context';
import type { CoreRouteRuntime, RouteRuntime } from './runtime';
import type { RouteResolver } from './types';
import { enableMatchValidation } from './match-controls';

export function enableResolverInstallation(runtime: CoreRouteRuntime): CoreRouteRuntime & Pick<RouteRuntime, 'installResolver'> {
  if ('installResolver' in runtime) return runtime as CoreRouteRuntime & Pick<RouteRuntime, 'installResolver'>;
  const context = routeControlContext(runtime);
  enableMatchValidation(runtime);
  function installResolver(nextResolver: RouteResolver): () => void {
    if (context.disposed) throw new Error('Cannot install a resolver on a disposed route runtime');
    if (context.blocking) throw new Error('Route blockers must not mutate router state');
    if (context.resolver !== null) {
      throw new Error('A route runtime can only have one structural resolver');
    }
    return context.publishResolver(nextResolver);
  }
  return Object.assign(runtime, { installResolver });
}
