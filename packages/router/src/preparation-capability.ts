/** Navigation discovers preparation work without importing its execution code. */
import type { RouteMatch } from './types';
import type { prepareRoutedMatches as prepare, RoutedPreparationMetadata } from './preparation';

let runner: typeof prepare | undefined;

export function installRoutePreparationRunner(preparation: typeof prepare): void {
  runner = preparation;
}

export function hasRoutedPreparations(matches: readonly RouteMatch[]): boolean {
  return matches.some(match => {
    const metadata = match.metadata as RoutedPreparationMetadata | undefined;
    return (metadata?.preparations?.length ?? 0) > 0 || typeof metadata?.moduleLoader === 'function';
  });
}

export const prepareRoutedMatches: typeof prepare = (runtime, matches, input) => {
  if (runner === undefined) return Promise.reject(new Error('memo-dom: route preparation capability is not installed'));
  return runner(runtime, matches, input);
};
