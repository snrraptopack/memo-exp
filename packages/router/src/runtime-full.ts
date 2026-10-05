/** Public construction exposes preparation support on the same route engine. */
import { createRouteRuntime as createRuntime } from './runtime';
import { prepareRoutedMatches } from './preparation';
import { installRoutePreparationRunner } from './preparation-capability';

export function createRouteRuntime(...args: Parameters<typeof createRuntime>): ReturnType<typeof createRuntime> {
  installRoutePreparationRunner(prepareRoutedMatches);
  return createRuntime(...args);
}
