/** Navigation discovers preparation work without importing its execution code. */
import type { RouteMatch } from './types';
import type { RoutedPreparationInput, RoutedPreparationOutcome, RoutedPreparationMetadata } from './preparation';
import type { RouteRuntime } from './runtime';

export interface RoutePreparationTransaction {
  prepare(match: RouteMatch): Promise<RoutedPreparationOutcome | undefined>;
  commit(): void;
}
type PreparationRunner = (runtime: RouteRuntime, input: RoutedPreparationInput) => RoutePreparationTransaction;
type ModuleLoader = (matches: readonly RouteMatch[], signal: AbortSignal) => Promise<void>;
let runner: PreparationRunner | undefined;
let loadModules: ModuleLoader | undefined;

export function installRoutePreparationRunner(preparation: PreparationRunner): void {
  runner = preparation;
}

export function installRouteModuleLoader(loader: ModuleLoader): void {
  loadModules = loader;
}

export function hasRoutedPreparations(matches: readonly RouteMatch[]): boolean {
  return matches.some(match => {
    const metadata = match.metadata as RoutedPreparationMetadata | undefined;
    return (metadata?.preparations?.length ?? 0) > 0 || typeof metadata?.moduleLoader === 'function';
  });
}

/** One parent-to-child pipeline; a parent gate can stop a later module load. */
export async function prepareRoutedMatches(
  runtime: RouteRuntime, matches: readonly RouteMatch[], input: RoutedPreparationInput,
): Promise<RoutedPreparationOutcome> {
  input.signal.throwIfAborted();
  let transaction: RoutePreparationTransaction | undefined;
  for (const match of matches) {
    if (loadModules !== undefined) await loadModules([match], input.signal);
    else if (typeof (match.metadata as RoutedPreparationMetadata | undefined)?.moduleLoader === 'function') {
      throw new Error('memo-dom: route module capability is not installed');
    }
    if (runner !== undefined) {
      transaction ??= runner(runtime, input);
      const outcome = await transaction.prepare(match);
      if (outcome?.kind === 'redirect') return outcome;
    } else if (((match.metadata as RoutedPreparationMetadata | undefined)?.preparations?.length ?? 0) > 0) {
      throw new Error('memo-dom: route preparation capability is not installed');
    }
  }
  input.signal.throwIfAborted();
  transaction?.commit();
  return {kind:'data',data:undefined};
}
