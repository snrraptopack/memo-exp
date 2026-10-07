/** Request input facts; unknown calls and escaping providers retain encoding. */
import type * as t from '../ast/compiler-types';
import * as factory from '../ast/factory';
import { unwrapTypeExpression, type BaseNode, type ScopeAnalysis } from '../ast';

export interface BodylessFetchImport {
  readonly statement: t.ImportDeclaration;
  readonly specifier: t.ImportSpecifier;
}

function bodylessCall(call: t.CallExpression, analysis: ScopeAnalysis): boolean {
  if (call.arguments.length < 1 || call.arguments.length > 2 ||
      !factory.isExpression(call.arguments[0])) return false;
  const argument = call.arguments[1];
  if (argument === undefined) return true;
  const options = unwrapTypeExpression(argument as unknown as BaseNode);
  if (factory.isIdentifier(options) && options.name === 'undefined' &&
      analysis.nodeToScope.get(options)?.getBinding(options.name) === undefined) return true;
  if (!factory.isObjectExpression(options)) return false;
  return options.properties.every(property => {
    if (!factory.isObjectProperty(property) || property.kind !== 'init' || property.method || property.computed) return false;
    const key = factory.isIdentifier(property.key) ? property.key.name
      : factory.isStringLiteral(property.key) ? property.key.value : null;
    if (key === null || key === 'body' || key === '__proto__') return false;
    return key !== 'method' || (factory.isStringLiteral(property.value) &&
      ['GET', 'HEAD'].includes(property.value.value.toUpperCase()));
  });
}

export function planBodylessFetchImports(
  program: t.Program,
  analysis: ScopeAnalysis,
  providers: ReadonlySet<string>,
): readonly BodylessFetchImport[] {
  const plans: BodylessFetchImport[] = [];
  for (const statement of program.body) {
    if (!factory.isImportDeclaration(statement) || statement.source.value !== '@memoized-dom/data') continue;
    for (const specifier of statement.specifiers) {
      if (!factory.isImportSpecifier(specifier) || !providers.has(specifier.local.name) ||
          !factory.isIdentifier(specifier.imported) || specifier.imported.name !== '$fetch') continue;
      const binding = analysis.nodeToScope.get(specifier.local)?.getBinding(specifier.local.name);
      if (binding === undefined || binding.references.length === 0) continue;
      if (binding.references.every(reference => {
        const parent = analysis.parentByNode.get(reference);
        return factory.isCallExpression(parent) && parent.callee === reference && bodylessCall(parent, analysis);
      })) plans.push(Object.freeze({statement, specifier}));
    }
  }
  return Object.freeze(plans);
}
