/** General hydration entry: installs all capabilities over the shared engine. */
import { installProgramHydration, hydrateList, hydrateMarkup } from './hydrate-program';

installProgramHydration({ list: hydrateList, markup: hydrateMarkup });
