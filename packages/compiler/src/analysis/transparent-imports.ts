/** Source/provider import metadata, independent of generated bindings. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import type { Ctx } from '../context/model';

function importedName(specifier: t.ImportSpecifier): string {
  return astFactory.isIdentifier(specifier.imported)
    ? specifier.imported.name
    : specifier.imported.value;
}

/** Resolve provider metadata to local import aliases before module analysis. */
export function scanTransparentSourceImports(
  ctx: Ctx,
  programPath: { node: t.Program },
): void {
  const definitions = new Map<string, typeof ctx.transparentAsyncSources[number][]>();
  for (const definition of ctx.transparentAsyncSources) {
    const entries = definitions.get(definition.module) ?? [];
    entries.push(definition);
    definitions.set(definition.module, entries);
  }
  for (const statement of programPath.node.body) {
    if (!astFactory.isImportDeclaration(statement)) continue;
    const moduleDefinitions = definitions.get(statement.source.value);
    if (moduleDefinitions === undefined) continue;
    for (const specifier of statement.specifiers) {
      if (!astFactory.isImportSpecifier(specifier)) continue;
      const name = importedName(specifier);
      const sourceDefinition = moduleDefinitions.find(definition => name === definition.source);
      if (sourceDefinition !== undefined) {
        ctx.transparentSourceFactories.add(specifier.local.name);
        if (sourceDefinition.source === '$read' && sourceDefinition.module === '@memoized-dom/data') {
          ctx.transparentReadFactories.add(specifier.local.name);
        } else if (sourceDefinition.source === '$forms' && sourceDefinition.module === '@memoized-dom/data') {
          ctx.transparentFormFactories.add(specifier.local.name);
        } else {
          ctx.transparentProviderFactories.add(specifier.local.name);
        }
        ctx.importedFunctions.set(specifier.local.name, {
          reads: new Set(),
          writes: new Set(),
          boundedWrites: new Set(),
          parameterWrites: [],
          unbounded: false,
        });
      }
      const passthrough = moduleDefinitions.find(definition =>
        name === definition.track || name === definition.operations
      );
      if (passthrough !== undefined) {
        ctx.transparentSourcePassthroughs.add(specifier.local.name);
        if (name === passthrough.track) {
          ctx.transparentTrackFactories.add(specifier.local.name);
        }
        ctx.importedFunctions.set(specifier.local.name, {
          reads: new Set(),
          writes: new Set(),
          boundedWrites: new Set(),
          parameterWrites: [],
          unbounded: false,
        });
      }
      if (moduleDefinitions.some(definition => name === definition.group)) {
        ctx.transparentGroups.add(specifier.local.name);
      }
    }
  }
}
