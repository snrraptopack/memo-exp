import type { CompiledModules } from '@memoized-dom/compiler';

export const hydrationVirtualId = 'virtual:memoized-dom/hydration';
export const resolvedHydrationVirtualId = `\0${hydrationVirtualId}`;

/** Runs as an imported module before the authored entry's mount call. */
export function hydrationBootstrap(capabilities: CompiledModules['hydrationCapabilities']): string {
  const names = ['installProgramHydration', ...(capabilities.list ? ['hydrateList'] : []),
    ...(capabilities.markup ? ['hydrateMarkup'] : [])];
  const fields = [...(capabilities.list ? ['list:hydrateList'] : []),
    ...(capabilities.markup ? ['markup:hydrateMarkup'] : [])];
  return `import {${names.join(',')}} from '@memoized-dom/runtime/hydrate-program';\ninstallProgramHydration({${fields.join(',')}});`;
}
