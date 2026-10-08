/** Public construction exposes preparation support on the same route engine. */
import { createRouteRuntime as createRuntime } from './runtime';
import { createRouteManifest } from './manifest';
import { createRoutePreparationTransaction } from './preparation';
import { prepareRouteModules } from './route-modules';
import { installRoutePreparationRunner, installRouteModuleLoader } from './preparation-capability';
import { exposeRouteRuntime } from './runtime-controls';
import type { RouteEnvironment, RouteRuntime, RouteRuntimeOptions } from './runtime';
import { validateRouteMatches } from './match-validation';

export function createRouteRuntime(
  optionsOrEnvironment: RouteEnvironment | RouteRuntimeOptions = typeof window === 'undefined' ? {} : (window as unknown as RouteEnvironment),
): RouteRuntime {
  installRoutePreparationRunner(createRoutePreparationTransaction);
  installRouteModuleLoader(prepareRouteModules);
  const isOptions = typeof optionsOrEnvironment === 'object' && optionsOrEnvironment !== null &&
    ('routes' in optionsOrEnvironment ||
      'resolver' in optionsOrEnvironment ||
      'environment' in optionsOrEnvironment ||
      'routeHistory' in optionsOrEnvironment ||
      'basePath' in optionsOrEnvironment);
  const options: RouteRuntimeOptions = isOptions
    ? (optionsOrEnvironment as RouteRuntimeOptions)
    : { environment: optionsOrEnvironment as RouteEnvironment };
  return exposeRouteRuntime(createRuntime(options, definitions => createRouteManifest(definitions).resolve, validateRouteMatches));
}
