/** Compiler module definitions share the core access-table catalog. */
import { getExtensionStore, installAccessTable, type AccessTable } from '@memoized-dom/runtime/core';

const initializers = new Map<string, { table: AccessTable; initialize(): void }>();

export function defineSceneModule(id: string, table: AccessTable, initialize: () => void): void {
  installAccessTable(table, 'Desktop', id);
  initializers.set(id, { table, initialize });
}

/** Register module derivations in each application, rather than the ambient app. */
export function initializeSceneModules(ids: readonly string[] = []): void {
  const scope = getExtensionStore('desktop:modules', () => ({
    requested: new Set<string>(),
    installed: new Set<string>(),
  }));
  for (const id of ids) scope.requested.add(id);
  for (const id of scope.requested) {
    const definition = initializers.get(id);
    if (!definition || scope.installed.has(id)) continue;
    // Module evaluation can precede application creation or run outside the
    // importer's async context. Activate its table explicitly with its entities.
    installAccessTable(definition.table, 'Desktop', id);
    definition.initialize();
    scope.installed.add(id);
  }
}
