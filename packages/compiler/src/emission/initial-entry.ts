/** Select the document mount operation from the shared initial-content proof. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { identifierLikeName, analyzeScope, walkAst, type BaseNode } from '../ast';

export function emitInitialMount(program: t.Program, runtimePath: string, payload = false): void {
  const analysis = payload ? analyzeScope(program) : undefined;
  const names = new Set<string>();
  if (payload) walkAst<BaseNode>(program, { enter(node) {
    if (astFactory.isIdentifier(node)) names.add(node.name);
  } });
  let payloadName = '_initialPayload';
  while (names.has(payloadName)) payloadName += '_';
  let payloadImport: t.ImportDeclaration | undefined;
  for (const statement of program.body) {
    if (!astFactory.isImportDeclaration(statement) || statement.source.value !== runtimePath || statement.importKind === 'type') continue;
    for (const specifier of statement.specifiers) {
      if (astFactory.isImportSpecifier(specifier) && specifier.importKind !== 'type' &&
          identifierLikeName(specifier.imported) === 'mount') {
        // Preserve authored aliases and locations for the entry's source map.
        specifier.imported = astFactory.identifier('mountInitial');
        if (analysis) {
          payloadImport = statement;
          const binding = analysis.rootScope.getBinding(specifier.local.name);
          for (const reference of binding?.references ?? []) {
            const call = analysis.parentByNode.get(reference);
            if (astFactory.isCallExpression(call) && call.callee === reference) {
              call.arguments.push(astFactory.identifier(payloadName));
            }
          }
        }
      }
    }
  }
  payloadImport?.specifiers.push(astFactory.importSpecifier(
    astFactory.identifier(payloadName), astFactory.identifier('initializePayload')));
}
