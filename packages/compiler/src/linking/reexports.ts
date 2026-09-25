/** Turn named reexports into ordinary imports and local exports for linking. */
import type * as t from '../ast/compiler-types';
import * as ast from '../ast/factory';
import { cloneNode, walkAst, type BaseNode } from '../ast';

export function normalizeNamedReexports(program: t.Program): void {
  if (!program.body.some((statement) =>
    ast.isExportNamedDeclaration(statement) && statement.source !== null)) return;
  const occupied = new Set<string>();
  walkAst(program as BaseNode, { enter(node) {
    if (ast.isIdentifier(node)) occupied.add(node.name);
  } });
  let serial = 0;
  const fresh = (): string => {
    let name: string;
    do { name = `__mmdReexport${serial++}`; } while (occupied.has(name));
    occupied.add(name);
    return name;
  };
  const body: t.Statement[] = [];
  for (const statement of program.body) {
    if (!ast.isExportNamedDeclaration(statement) || statement.source === null) {
      body.push(statement);
      continue;
    }
    if ((statement as t.ExportNamedDeclaration & { exportKind?: string }).exportKind === 'type') {
      continue;
    }
    const imports: t.ImportSpecifier[] = [];
    const exports: t.ExportSpecifier[] = [];
    for (const specifier of statement.specifiers) {
      if ((specifier as t.ExportSpecifier & { exportKind?: string }).exportKind === 'type') {
        continue;
      }
      if (!ast.isExportSpecifier(specifier)) {
        throw new Error('memo-dom: named reexports require statically named exports');
      }
      const local = ast.identifier(fresh());
      imports.push(ast.importSpecifier(ast.identifier(local.name),
        cloneNode(specifier.local as BaseNode, true) as t.Identifier));
      exports.push(ast.exportSpecifier(ast.identifier(local.name),
        cloneNode(specifier.exported as BaseNode, true) as t.Identifier | t.StringLiteral));
    }
    if (imports.length === 0) continue;
    body.push(ast.importDeclaration(imports,
      cloneNode(statement.source as BaseNode, true) as t.StringLiteral));
    body.push(ast.exportNamedDeclaration(null, exports));
  }
  program.body = body;
}
