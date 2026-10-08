/** Compiler bridge for live values owned by external libraries. */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { registerState } from '../context';
import type {Ctx} from '../context';

interface ProgramContainer {
  node: t.Program;
}

function importedName(specifier: t.ImportSpecifier): string {
  return astFactory.isIdentifier(specifier.imported)
    ? specifier.imported.name
    : specifier.imported.value;
}

/**
 * Register configured external values as read-only reactive roots and capture
 * subscription contracts. Detection is metadata-driven; no library, method, or
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

      const local=specifier.local.name;
      ctx.externalReactiveBindings.set(local,definition.subscribe);
      if (
        definition.module === '@memoized-dom/router' &&
        definition.source === 'route' &&
        definition.subscribe.module === '@memoized-dom/router/internal' &&
        definition.subscribe.export === 'subscribeRouteValue'
      ) {
        ctx.routeReactiveBindings.add(local);
      }
      ctx.importedState.add(local);
      // `computed` keeps this imported facade out of SSR state-cell lifting.
      // The adapter supplies invalidation; the value itself remains read-only.
      registerState(ctx, local, 'computed');
    }
  }
}
