/** Compiler bridge for live values owned by external libraries. */

import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import { registerState, type Ctx } from './context';
import { generatedIdentifier } from './identifiers';

interface ProgramContainer {
  node: t.Program;
}

function importedName(specifier: t.ImportSpecifier): string {
  return astFactory.isIdentifier(specifier.imported)
    ? specifier.imported.name
    : specifier.imported.value;
}

/**
 * Register configured external values as read-only reactive roots and prepare
 * their adapter imports. Detection is metadata-driven; no library, method, or
 * operation name is baked into the analysis.
 */
export function scanExternalReactiveImports(
  ctx: Ctx,
  programPath: ProgramContainer,
): void {
  const definitions = new Map(
    ctx.externalReactiveSources.map(definition => [
      `${definition.module}\0${definition.source}`,
      definition,
    ]),
  );

  for (const statement of programPath.node.body) {
    if (!astFactory.isImportDeclaration(statement)) continue;
    const sourceModule = statement.source.value;
    for (const specifier of statement.specifiers) {
      const sourceName = astFactory.isImportDefaultSpecifier(specifier)
        ? 'default'
        : astFactory.isImportSpecifier(specifier)
          ? importedName(specifier)
          : null;
      if (sourceName === null) continue;
      const definition = definitions.get(`${sourceModule}\0${sourceName}`);
      if (definition === undefined) continue;

      const adapterKey =
        `${definition.subscribe.module}\0${definition.subscribe.export}`;
      let adapter = ctx.externalReactiveImports.get(adapterKey);
      if (adapter === undefined) {
        adapter = {
          module: definition.subscribe.module,
          imported: definition.subscribe.export,
          local: generatedIdentifier(ctx, 'subscribeExternal').name,
        };
        ctx.externalReactiveImports.set(adapterKey, adapter);
      }

      const local = specifier.local.name;
      ctx.externalReactiveBindings.set(local, adapter.local);
      ctx.importedState.add(local);
      // `computed` keeps this imported facade out of SSR state-cell lifting.
      // The adapter supplies invalidation; the value itself remains read-only.
      registerState(ctx, local, 'computed');
    }
  }
}

/** Imports required only by live external bindings actually used in a file. */
export function externalReactiveImportStatements(ctx: Ctx): t.ImportDeclaration[] {
  return [...ctx.externalReactiveImports.values()].map(adapter =>
    astFactory.importDeclaration(
      [
        astFactory.importSpecifier(
          astFactory.identifier(adapter.local),
          astFactory.identifier(adapter.imported),
        ),
      ],
      astFactory.stringLiteral(adapter.module),
    ),
  );
}
