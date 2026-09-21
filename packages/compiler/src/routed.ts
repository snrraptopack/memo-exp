/** Compiler discovery and validation for route preparation intrinsics. */

import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import { walkAst, type BaseNode } from './ast';
import {
  astBindingAt,
  type Ctx,
  type ProgramPath,
} from './context';

const ROUTER_MODULE = '@memoized-dom/router';
const SERVER_CONTEXT_FIELDS = new Set([
  'request',
  'locals',
  'services',
  'platform',
]);

export interface CompilerRoutedPreparation {
  readonly id: string;
  readonly moduleId: string;
  readonly component: string;
  readonly binding: string;
  readonly contextFields: readonly string[];
  readonly server: boolean;
  readonly line?: number;
  readonly column?: number;
}

function importedName(specifier: t.ImportSpecifier): string {
  return astFactory.isIdentifier(specifier.imported)
    ? specifier.imported.name
    : specifier.imported.value;
}

function routedBindings(program: t.Program): Set<string> {
  const bindings = new Set<string>();
  for (const statement of program.body) {
    if (
      !astFactory.isImportDeclaration(statement) ||
      statement.importKind === 'type' ||
      statement.source.value !== ROUTER_MODULE
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (
        astFactory.isImportSpecifier(specifier) &&
        specifier.importKind !== 'type' &&
        importedName(specifier) === '$routed'
      ) {
        bindings.add(specifier.local.name);
      }
    }
  }
  return bindings;
}

function staticPropertyName(property: t.ObjectProperty): string | null {
  if (!property.computed && astFactory.isIdentifier(property.key)) {
    return property.key.name;
  }
  if (astFactory.isStringLiteral(property.key)) return property.key.value;
  return null;
}

function contextFields(
  callback: t.ArrowFunctionExpression | t.FunctionExpression,
  programPath: ProgramPath,
): string[] {
  if (callback.params.length === 0) return [];
  if (callback.params.length !== 1 || !astFactory.isObjectPattern(callback.params[0])) {
    throw programPath.buildCodeFrameError(
      'memo-dom: $routed callback must receive one destructured context object',
      callback,
    );
  }
  const fields: string[] = [];
  for (const property of callback.params[0].properties) {
    if (astFactory.isRestElement(property)) {
      throw programPath.buildCodeFrameError(
        'memo-dom: $routed context does not support a rest binding because execution capabilities must remain statically visible',
        property,
      );
    }
    if (!astFactory.isObjectProperty(property)) continue;
    const name = staticPropertyName(property);
    if (name === null) {
      throw programPath.buildCodeFrameError(
        'memo-dom: $routed context fields must use static property names',
        property,
      );
    }
    fields.push(name);
  }
  return [...new Set(fields)];
}

function directConstDeclarator(
  ctx: Ctx,
  call: t.CallExpression,
): t.VariableDeclarator | null {
  const parents = ctx.astAnalysis?.parentByNode;
  if (parents === undefined) return null;
  let current = call as unknown as BaseNode;
  let parent = parents.get(current) ?? null;
  while (
    parent !== null &&
    (parent.type === 'TSAsExpression' ||
      parent.type === 'TSTypeAssertion' ||
      parent.type === 'TSNonNullExpression' ||
      parent.type === 'TSSatisfiesExpression')
  ) {
    current = parent;
    parent = parents.get(current) ?? null;
  }
  if (
    parent === null ||
    !astFactory.isVariableDeclarator(parent) ||
    parent.init !== current ||
    !astFactory.isIdentifier(parent.id)
  ) {
    return null;
  }
  const declaration = parents.get(parent as unknown as BaseNode) ?? null;
  return astFactory.isVariableDeclaration(declaration) && declaration.kind === 'const'
    ? parent
    : null;
}

function owningComponent(ctx: Ctx, call: t.CallExpression): string | null {
  const parents = ctx.astAnalysis?.parentByNode;
  if (parents === undefined) return null;
  const componentByNode = new Map<BaseNode, string>(
    [...ctx.compPaths].map(([name, path]) => [
      path.node as unknown as BaseNode,
      name,
    ]),
  );
  let current: BaseNode | null = call as unknown as BaseNode;
  while (current !== null) {
    const component = componentByNode.get(current);
    if (component !== undefined) return component;
    current = parents.get(current) ?? null;
    if (current !== null && astFactory.isFunction(current)) {
      return componentByNode.get(current) ?? null;
    }
  }
  return null;
}

/**
 * Finds statically extractable `$routed` sites after normal component and
 * lexical-scope discovery. This pass records execution classification but does
 * not yet emit the route/server transport.
 */
export function analyzeRoutedPreparations(
  ctx: Ctx,
  programPath: ProgramPath,
): CompilerRoutedPreparation[] {
  const bindings = routedBindings(programPath.node);
  if (bindings.size === 0) return [];
  const counters = new Map<string, number>();
  const preparations: CompilerRoutedPreparation[] = [];

  walkAst<BaseNode>(programPath.node as unknown as BaseNode, {
    enter(node) {
      if (!astFactory.isCallExpression(node) || !astFactory.isIdentifier(node.callee)) {
        return;
      }
      const local = node.callee.name;
      if (!bindings.has(local)) return;
      if (astBindingAt(ctx, node, local)?.kind !== 'import') return;

      const component = owningComponent(ctx, node);
      if (component === null) {
        throw programPath.buildCodeFrameError(
          'memo-dom: $routed must be declared directly in a component, not at module scope or inside a nested callback',
          node,
        );
      }
      const declarator = directConstDeclarator(ctx, node);
      if (declarator === null || !astFactory.isIdentifier(declarator.id)) {
        throw programPath.buildCodeFrameError(
          'memo-dom: assign $routed directly to a component-local const binding',
          node,
        );
      }
      if (node.arguments.length !== 1) {
        throw programPath.buildCodeFrameError(
          'memo-dom: $routed requires exactly one inline preparation callback',
          node,
        );
      }
      const argument = node.arguments[0];
      if (
        argument === undefined ||
        (!astFactory.isArrowFunctionExpression(argument) &&
          !astFactory.isFunctionExpression(argument))
      ) {
        throw programPath.buildCodeFrameError(
          'memo-dom: $routed requires an inline preparation callback so the compiler can extract its server boundary',
          argument ?? node,
        );
      }
      if (argument.async) {
        throw programPath.buildCodeFrameError(
          'memo-dom: $routed preparation is colorless at the callsite; return service or server-function work without authoring async/await here',
          argument,
        );
      }
      if (argument.generator) {
        throw programPath.buildCodeFrameError(
          'memo-dom: $routed preparation cannot be a generator',
          argument,
        );
      }

      const fields = contextFields(argument, programPath);
      const index = counters.get(component) ?? 0;
      counters.set(component, index + 1);
      const location = node.loc?.start;
      preparations.push({
        id: `${ctx.moduleId}#routed:${component}:${index}`,
        moduleId: ctx.moduleId,
        component,
        binding: declarator.id.name,
        contextFields: fields,
        server: fields.some(field => SERVER_CONTEXT_FIELDS.has(field)),
        ...(location?.line === undefined ? {} : { line: location.line }),
        ...(location?.column === undefined ? {} : { column: location.column }),
      });
    },
  });

  return preparations;
}
