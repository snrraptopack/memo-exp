/** Lower proved imports without changing source binding identities or calls. */
import type * as t from '../../ast/compiler-types';
import * as factory from '../../ast/factory';
import type { BodylessFetchImport } from '../../planning/fetch-encoding';

export function lowerBodylessFetchImports(program: t.Program, plans: readonly BodylessFetchImport[],
  delivery: 'universal' | 'client' = 'universal'): ReadonlySet<string> {
  const names = new Set<string>();
  for (const {statement, specifier} of plans) {
    names.add(specifier.local.name);
    statement.specifiers.splice(statement.specifiers.indexOf(specifier), 1);
    program.body.splice(program.body.indexOf(statement), 0, factory.importDeclaration([
      factory.importSpecifier(specifier.local, factory.identifier(delivery === 'client' ? 'createClientSource' : 'createBodylessSource')),
    ], factory.stringLiteral('@memoized-dom/data/internal')));
    if (statement.specifiers.length === 0) program.body.splice(program.body.indexOf(statement), 1);
  }
  return names;
}
