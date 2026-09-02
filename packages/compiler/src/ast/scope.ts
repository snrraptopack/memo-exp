/**
 * Pure lexical scope analysis for standard ESTree ASTs.
 *
 * Replaces Babel's stateful `path.scope` with a fast, deterministic,
 * tree-structured lexical scope model.
 */

import type {
  BaseNode,
  Identifier,
  Program,
} from './types';
import { walkAst } from './walk';
import { isIdentifier } from './builders';

export type BindingKind =
  | 'var'
  | 'let'
  | 'const'
  | 'param'
  | 'function'
  | 'class'
  | 'import';

export interface Binding {
  name: string;
  kind: BindingKind;
  identifier: Identifier;
  declarationNode: BaseNode;
  scope: Scope;
  references: Identifier[];
  constantViolations: BaseNode[];
}

export class Scope {
  public parent: Scope | null = null;
  public children: Scope[] = [];
  public bindings: Map<string, Binding> = new Map();
  public block: BaseNode;
  public isFunctionScope: boolean;
  public isProgramScope: boolean;

  constructor(
    block: BaseNode,
    parent: Scope | null = null,
    isFunctionScope = false,
  ) {
    this.block = block;
    this.parent = parent;
    this.isFunctionScope = isFunctionScope;
    this.isProgramScope = parent === null;
    if (parent) {
      parent.children.push(this);
    }
  }

  public registerBinding(
    name: string,
    kind: BindingKind,
    identifier: Identifier,
    declarationNode: BaseNode,
  ): Binding {
    const binding: Binding = {
      name,
      kind,
      identifier,
      declarationNode,
      scope: this,
      references: [],
      constantViolations: [],
    };
    this.bindings.set(name, binding);
    return binding;
  }

  public getBinding(name: string): Binding | undefined {
    return this.bindings.get(name) ?? this.parent?.getBinding(name);
  }

  public hasBinding(name: string): boolean {
    return this.getBinding(name) !== undefined;
  }

  public hasOwnBinding(name: string): boolean {
    return this.bindings.has(name);
  }

  public getProgramScope(): Scope {
    return this.parent?.getProgramScope() ?? this;
  }

  public getFunctionScope(): Scope | null {
    if (this.isFunctionScope) return this;
    return this.parent?.getFunctionScope() ?? null;
  }
}

function field(node: BaseNode, name: string): unknown {
  return (node as unknown as Record<string, unknown>)[name];
}

function isNode(value: unknown): value is BaseNode {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function childNode(node: BaseNode, name: string): BaseNode | null {
  const value = field(node, name);
  return isNode(value) ? value : null;
}

function childNodes(node: BaseNode, name: string): BaseNode[] {
  const value = field(node, name);
  return Array.isArray(value) ? value.filter(isNode) : [];
}

function asIdentifier(node: BaseNode | null): Identifier | null {
  return node?.type === 'Identifier'
    ? (node as unknown as Identifier)
    : null;
}

export function extractPatternIdentifiers(pattern: BaseNode): Identifier[] {
  const identifiers: Identifier[] = [];
  if (pattern.type === 'Identifier') {
    identifiers.push(pattern as unknown as Identifier);
  } else if (pattern.type === 'ObjectPattern') {
    for (const property of childNodes(pattern, 'properties')) {
      if (property.type === 'Property' || property.type === 'ObjectProperty') {
        const value = childNode(property, 'value');
        if (value !== null) {
          identifiers.push(...extractPatternIdentifiers(value));
        }
      } else if (property.type === 'RestElement') {
        identifiers.push(...extractPatternIdentifiers(property));
      }
    }
  } else if (pattern.type === 'ArrayPattern') {
    for (const element of childNodes(pattern, 'elements')) {
      identifiers.push(...extractPatternIdentifiers(element));
    }
  } else if (pattern.type === 'RestElement') {
    const argument = childNode(pattern, 'argument');
    if (argument !== null) {
      identifiers.push(...extractPatternIdentifiers(argument));
    }
  } else if (pattern.type === 'AssignmentPattern') {
    const left = childNode(pattern, 'left');
    if (left !== null) identifiers.push(...extractPatternIdentifiers(left));
  } else if (pattern.type === 'TSParameterProperty') {
    const parameter = childNode(pattern, 'parameter');
    if (parameter !== null) {
      identifiers.push(...extractPatternIdentifiers(parameter));
    }
  }
  return identifiers;
}

export function isReferenceIdentifier(
  parent: BaseNode | null,
  key: string | undefined,
): boolean {
  if (parent === null) return false;
  if (
    (parent.type === 'MemberExpression' &&
      key === 'property' &&
      field(parent, 'computed') === false) ||
    (parent.type === 'OptionalMemberExpression' &&
      key === 'property' &&
      field(parent, 'computed') === false) ||
    ((parent.type === 'Property' || parent.type === 'ObjectProperty') &&
      key === 'key' &&
      field(parent, 'computed') === false) ||
    (parent.type === 'MethodDefinition' &&
      key === 'key' &&
      field(parent, 'computed') === false) ||
    (parent.type === 'LabeledStatement' && key === 'label') ||
    ((parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') &&
      key === 'label') ||
    (parent.type === 'ExportSpecifier' && key === 'exported') ||
    parent.type === 'MetaProperty' ||
    parent.type.startsWith('TS')
  ) {
    return false;
  }
  return !parent.type.startsWith('Import');
}

function bindingViolation(
  identifier: BaseNode,
  parentByNode: Map<BaseNode, BaseNode | null>,
  keyByNode: Map<BaseNode, string | undefined>,
): BaseNode | null {
  let current = identifier;
  let parent = parentByNode.get(current) ?? null;
  while (parent !== null) {
    const key = keyByNode.get(current);
    if (parent.type === 'UpdateExpression' && key === 'argument') return parent;
    if (parent.type === 'AssignmentExpression') {
      return key === 'left' ? parent : null;
    }
    if (parent.type === 'ForInStatement' || parent.type === 'ForOfStatement') {
      return key === 'left' ? parent : null;
    }
    if (
      parent.type !== 'ArrayPattern' &&
      parent.type !== 'ObjectPattern' &&
      parent.type !== 'AssignmentPattern' &&
      parent.type !== 'RestElement' &&
      parent.type !== 'Property' &&
      parent.type !== 'ObjectProperty'
    ) {
      return null;
    }
    current = parent;
    parent = parentByNode.get(current) ?? null;
  }
  return null;
}

/** Analyze lexical scopes of an AST tree. */
export interface ScopeAnalysis {
  rootScope: Scope;
  nodeToScope: Map<BaseNode, Scope>;
  parentByNode: Map<BaseNode, BaseNode | null>;
  keyByNode: Map<BaseNode, string | undefined>;
  indexByNode: Map<BaseNode, number | undefined>;
}

export function analyzeScope(root: Program | BaseNode): ScopeAnalysis {
  const rootScope = new Scope(root, null, false);
  const nodeToScope = new Map<BaseNode, Scope>();
  const parentByNode = new Map<BaseNode, BaseNode | null>();
  const keyByNode = new Map<BaseNode, string | undefined>();
  const indexByNode = new Map<BaseNode, number | undefined>();
  const scopeOwners = new Map<BaseNode, Scope>();
  const bindingIdentifiers = new Set<Identifier>();
  let currentScope = rootScope;
  nodeToScope.set(root, rootScope);

  walkAst(root, {
    enter(node, parent, key, index) {
      parentByNode.set(node, parent);
      keyByNode.set(node, key);
      indexByNode.set(node, index);
      if (node.type === 'FunctionDeclaration') {
        const id = asIdentifier(childNode(node, 'id'));
        if (id !== null) {
          currentScope.registerBinding(
            id.name,
            'function',
            id,
            node,
          );
          bindingIdentifiers.add(id);
        }
      } else if (node.type === 'ClassDeclaration') {
        const id = asIdentifier(childNode(node, 'id'));
        if (id !== null) {
          currentScope.registerBinding(
            id.name,
            'class',
            id,
            node,
          );
          bindingIdentifiers.add(id);
        }
      }

      // Function boundaries create function scopes.
      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        const fnScope = new Scope(node, currentScope, true);
        scopeOwners.set(node, fnScope);
        currentScope = fnScope;
        nodeToScope.set(node, fnScope);

        const functionId = asIdentifier(childNode(node, 'id'));
        if (node.type === 'FunctionExpression' && functionId !== null) {
          fnScope.registerBinding(
            functionId.name,
            'function',
            functionId,
            node,
          );
          bindingIdentifiers.add(functionId);
        }

        for (const param of childNodes(node, 'params')) {
          for (const id of extractPatternIdentifiers(param)) {
            fnScope.registerBinding(id.name, 'param', id, node);
            bindingIdentifiers.add(id);
          }
        }
        return;
      }

      // Blocks, loops, switches, and catches own lexical declarations.
      if (node.type === 'BlockStatement') {
        const isFnBody =
          parent &&
          (parent.type === 'FunctionDeclaration' ||
            parent.type === 'FunctionExpression' ||
            parent.type === 'ArrowFunctionExpression');
        if (isFnBody) {
          nodeToScope.set(node, currentScope);
          return;
        }

        const blockScope = new Scope(node, currentScope, false);
        scopeOwners.set(node, blockScope);
        nodeToScope.set(node, blockScope);
        currentScope = blockScope;
        return;
      }

      if (
        node.type === 'ForStatement' ||
        node.type === 'ForInStatement' ||
        node.type === 'ForOfStatement' ||
        node.type === 'SwitchStatement' ||
        node.type === 'CatchClause'
      ) {
        const lexicalScope = new Scope(node, currentScope, false);
        scopeOwners.set(node, lexicalScope);
        currentScope = lexicalScope;
        nodeToScope.set(node, lexicalScope);
        if (node.type === 'CatchClause') {
          const parameter = childNode(node, 'param');
          if (parameter !== null) {
            for (const id of extractPatternIdentifiers(parameter)) {
              lexicalScope.registerBinding(id.name, 'param', id, node);
              bindingIdentifiers.add(id);
            }
          }
        }
        return;
      }

      nodeToScope.set(node, currentScope);

      if (node.type === 'VariableDeclaration') {
        const kind = field(node, 'kind');
        if (kind !== 'var' && kind !== 'let' && kind !== 'const') return;
        const targetScope =
          kind === 'var'
            ? currentScope.getFunctionScope() ?? currentScope.getProgramScope()
            : currentScope;
        for (const declaration of childNodes(node, 'declarations')) {
          const pattern = childNode(declaration, 'id');
          if (pattern === null) continue;
          for (const id of extractPatternIdentifiers(pattern)) {
            targetScope.registerBinding(id.name, kind, id, node);
            bindingIdentifiers.add(id);
          }
        }
      }

      if (node.type === 'ImportDeclaration') {
        const programScope = currentScope.getProgramScope();
        for (const specifier of childNodes(node, 'specifiers')) {
          const local = childNode(specifier, 'local');
          if (local !== null && isIdentifier(local)) {
            programScope.registerBinding(local.name, 'import', local, node);
            bindingIdentifiers.add(local);
          }
        }
      }
    },

    leave(node) {
      if (scopeOwners.get(node) === currentScope && currentScope.parent !== null) {
        currentScope = currentScope.parent;
      }
    },
  });

  currentScope = rootScope;
  walkAst(root, {
    enter(node, parent, key) {
      const ownedScope = scopeOwners.get(node);
      if (ownedScope !== undefined) currentScope = ownedScope;
      if (
        isIdentifier(node) &&
        !bindingIdentifiers.has(node) &&
        isReferenceIdentifier(parent, key)
      ) {
        const binding = currentScope.getBinding(node.name);
        if (binding !== undefined) {
          binding.references.push(node);
          const violation = bindingViolation(node, parentByNode, keyByNode);
          if (
            violation !== null &&
            !binding.constantViolations.includes(violation)
          ) {
            binding.constantViolations.push(violation);
          }
        }
      }
    },
    leave(node) {
      if (scopeOwners.get(node) === currentScope && currentScope.parent !== null) {
        currentScope = currentScope.parent;
      }
    },
  });

  return {
    rootScope,
    nodeToScope,
    parentByNode,
    keyByNode,
    indexByNode,
  };
}
