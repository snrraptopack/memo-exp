/**
 * Optional hydration runtime entry.
 *
 * `import '@memoized-dom/runtime/hydrate'` installs the adoption runtime so
 * mount() can claim matching server markup. Applications without SSR never
 * import this entry and the hydration implementation stays out of the
 * browser bundle. When server markup is present but this entry was not
 * imported, mount() warns and falls back to a fresh client mount.
 */

import { installHydrationRuntime } from './mount';
import { hydrateApplicationRoot } from './hydration';

installHydrationRuntime(hydrateApplicationRoot);

export {};
