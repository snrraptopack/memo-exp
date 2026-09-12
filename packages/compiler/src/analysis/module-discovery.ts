/**
 * Parser-neutral discovery of module imports and top-level functions.
 *
 * This pass deliberately returns raw ESTree nodes. Frontends may attach their
 * own diagnostic or mutation handles after discovery without making the
 * semantic classification depend on a parser-specific path implementation.
 */

import {
  asNode as childNode,
  identifierName,
  nodeArray as childNodes,
  nodeFields as record,
  walkAst,
  type BaseNode,
} from '../ast';

export type DiscoveredFunctionKind = 'component' | 'helper' | 'jsx-helper';

export interface DiscoveredFunction {
  name: string;
  kind: DiscoveredFunctionKind;
  node: BaseNode;
}

export interface UnlinkedValueImport {
  local: string;
  declaration: BaseNode;
}

function declarationOf(statement: BaseNode): BaseNode | null {
  return statement.type === 'ExportNamedDeclaration' ||
    statement.type === 'ExportDefaultDeclaration'
    ? childNode(record(statement).declaration)
    : statement;
}

/** Strip transparent TypeScript expression wrappers around an initializer. */
export function unwrapFunctionExpression(node: BaseNode | null): BaseNode | null {
  let current = node;
  while (
    current !== null &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSTypeAssertion' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSInstantiationExpression')
  ) {
    current = childNode(record(current).expression);
  }
  return current?.type === 'ArrowFunctionExpression' ||
    current?.type === 'FunctionExpression'
    ? current
    : null;
}

/** Whether a raw ESTree subtree contains authored JSX. */
export function subtreeHasJsx(root: BaseNode): boolean {
  let found = false;
  walkAst(root, {
    enter(node) {
      if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
        found = true;
        return false;
      }
      return found ? false : undefined;
    },
  });
  return found;
}

/** Classify declarations that the component analysis owns at module scope. */
export function discoverTopLevelFunctions(program: BaseNode): DiscoveredFunction[] {
  if (program.type !== 'Program') return [];
  const discovered: DiscoveredFunction[] = [];
  for (const statement of childNodes(record(program).body)) {
    const declaration = declarationOf(statement);
    if (declaration === null) continue;
    if (declaration.type === 'FunctionDeclaration') {
      const name = identifierName(childNode(record(declaration).id));
      if (name === null) continue;
      const hasJsx = subtreeHasJsx(declaration);
      discovered.push({
        name,
        kind: hasJsx
          ? /^[A-Z]/.test(name) ? 'component' : 'jsx-helper'
          : 'helper',
        node: declaration,
      });
      continue;
    }
    if (declaration.type !== 'VariableDeclaration') continue;
    for (const declarator of childNodes(record(declaration).declarations)) {
      if (declarator.type !== 'VariableDeclarator') continue;
      const name = identifierName(childNode(record(declarator).id));
      const fn = unwrapFunctionExpression(childNode(record(declarator).init));
      if (name === null || fn === null) continue;
      const hasJsx = subtreeHasJsx(childNode(record(fn).body) ?? fn);
      if (hasJsx && /^[A-Z]/.test(name)) continue;
      discovered.push({
        name,
        kind: hasJsx ? 'jsx-helper' : 'helper',
        node: fn,
      });
    }
  }
  return discovered;
}

/** Find runtime imports whose identities were not supplied by graph linking. */
export function findUnlinkedValueImports(
  program: BaseNode,
  linked: ReadonlySet<string>,
): UnlinkedValueImport[] {
  if (program.type !== 'Program') return [];
  const output: UnlinkedValueImport[] = [];
  for (const statement of childNodes(record(program).body)) {
    if (
      statement.type !== 'ImportDeclaration' ||
      record(statement).importKind === 'type'
    ) {
      continue;
    }
    for (const specifier of childNodes(record(statement).specifiers)) {
      if (
        specifier.type === 'ImportSpecifier' &&
        record(specifier).importKind === 'type'
      ) {
        continue;
      }
      const local = identifierName(childNode(record(specifier).local));
      if (local !== null && !linked.has(local)) {
        output.push({ local, declaration: statement });
      }
    }
  }
  return output;
}
