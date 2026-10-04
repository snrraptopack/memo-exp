/** Select the document mount operation from the shared initial-content proof. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { identifierLikeName } from '../ast';

export function emitInitialMount(program: t.Program, runtimePath: string): void {
  for (const statement of program.body) {
    if (!astFactory.isImportDeclaration(statement) || statement.source.value !== runtimePath || statement.importKind === 'type') continue;
    for (const specifier of statement.specifiers) {
      if (astFactory.isImportSpecifier(specifier) && specifier.importKind !== 'type' &&
          identifierLikeName(specifier.imported) === 'mount') {
        // Preserve authored aliases and locations for the entry's source map.
        specifier.imported = astFactory.identifier('mountInitial');
      }
    }
  }
}
