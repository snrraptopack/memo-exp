/** Shared authored export bindings for compiler targets. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';

export function exportedLocals(program: t.Program): Map<string, string> {
  const out = new Map<string, string>();
  for (const stmt of program.body) {
    if (astFactory.isExportDefaultDeclaration(stmt)) {
      if (
        (astFactory.isFunctionDeclaration(stmt.declaration) ||
          astFactory.isClassDeclaration(stmt.declaration)) &&
        stmt.declaration.id != null
      ) {
        out.set('default', stmt.declaration.id.name);
      } else if (astFactory.isIdentifier(stmt.declaration)) {
        out.set('default', stmt.declaration.name);
      }
      continue;
    }
    if (!astFactory.isExportNamedDeclaration(stmt)) continue;
    if (stmt.source !== null) {
      throw new Error(
        `memo-dom: re-export-from declarations are not supported by compileModules(); import then export the binding explicitly`,
      );
    }
    const decl = stmt.declaration;
    if (astFactory.isVariableDeclaration(decl)) {
      for (const item of decl.declarations) {
        if (astFactory.isIdentifier(item.id)) out.set(item.id.name, item.id.name);
      }
    } else if (astFactory.isFunctionDeclaration(decl) && decl.id != null) {
      out.set(decl.id.name, decl.id.name);
    }
    for (const spec of stmt.specifiers) {
      if (!astFactory.isExportSpecifier(spec)) continue;
      const local = spec.local.name;
      const exported = astFactory.isStringLiteral(spec.exported)
        ? spec.exported.value
        : spec.exported.name;
      out.set(exported, local);
    }
  }
  return out;
}
