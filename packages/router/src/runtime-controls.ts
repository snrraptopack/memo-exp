/** Full public API projection over the same engine used by compiled routing. */
import type { CoreRouteRuntime, RouteRuntime } from './runtime';
import { enableNavigationBlockers } from './navigation-blockers';
import { enableNavigationObservers } from './navigation-observers';
import { enableRelativeNavigation } from './relative-navigation';
import { enableResolverInstallation } from './resolver-installation';
import { enableHistoryControls } from './history-controls';
import { enableGeneralNavigation } from './general-navigation';
import { enableRouteSnapshots } from './snapshot-controls';
import { enableMatchValidation, enableManualMatches } from './match-controls';

export function exposeRouteRuntime(runtime: CoreRouteRuntime): RouteRuntime {
  enableMatchValidation(runtime);
  enableManualMatches(runtime);
  enableNavigationBlockers(runtime);
  enableNavigationObservers(runtime);
  enableRelativeNavigation(runtime);
  enableResolverInstallation(runtime);
  enableHistoryControls(runtime);
  enableGeneralNavigation(runtime);
  enableRouteSnapshots(runtime);
  return runtime as RouteRuntime;
}
