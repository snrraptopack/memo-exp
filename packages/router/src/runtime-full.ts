/** Public construction exposes preparation support on the same route engine. */
import { createRouteRuntime as createRuntime } from './runtime';
import { createRoutePreparationTransaction } from './preparation';
import { prepareRouteModules } from './route-modules';
import { installRoutePreparationRunner, installRouteModuleLoader } from './preparation-capability';

export function createRouteRuntime(...args: Parameters<typeof createRuntime>): ReturnType<typeof createRuntime> {
  installRoutePreparationRunner(createRoutePreparationTransaction);
  installRouteModuleLoader(prepareRouteModules);
  return createRuntime(...args);
}
