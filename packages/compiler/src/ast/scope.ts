/**
 * Pure lexical scope analysis for standard ESTree ASTs.
 *
 * Replaces Babel's stateful `path.scope` with a fast, deterministic,
 * tree-structured lexical scope model.
 */

import type {
  BaseNode,
  CatchClause,
  ClassDeclaration,
  FunctionDeclaration,
  Identifier,
  MemberExpression,
  MethodDefinition,
  Pattern,
  Program,
  Property,
  VariableDeclaration,
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

export function extractPatternIdentifiers(pattern: Pattern): Identifier[] {
  const identifiers: Identifier[] = [];
  if (pattern.type === 'Identifier') {
    identifiers.push(pattern);
  } else if (pattern.type === 'ObjectPattern') {
    for (const property of pattern.properties) {
      if (property.type === 'Property') {
        identifiers.push(...extractPatternIdentifiers(property.value as Pattern));
      } else if (property.type === 'RestElement') {
        identifiers.push(...extractPatternIdentifiers(property.argument));
      }
    }
  } else if (pattern.type === 'ArrayPattern') {
    for (const elem of pattern.elements) {
      if (elem) {
        identifiers.push(...extractPatternIdentifiers(elem));
      }
    }
  } else if (pattern.type === 'RestElement') {
    identifiers.push(...extractPatternIdentifiers(pattern.argument));
  } else if (pattern.type === 'AssignmentPattern') {
    identifiers.push(...extractPatternIdentifiers(pattern.left));
  }
  return identifiers;
}

function isReferenceIdentifier(
  parent: BaseNode | null,
  key: string | undefined,
): boolean {
  if (parent === null) return false;
  if (
    (parent.type === 'MemberExpression' &&
      key === 'property' &&
      (parent as unknown as MemberExpression).computed === false) ||
    (parent.type === 'Property' &&
      key === 'key' &&
      (parent as unknown as Property).computed === false) ||
    (parent.type === 'MethodDefinition' &&
      key === 'key' &&
      (parent as unknown as MethodDefinition).computed === false) ||
    (parent.type === 'LabeledStatement' && key === 'label') ||
    ((parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') &&
      key === 'label') ||
    (parent.type === 'ExportSpecifier' && key === 'exported') ||
    parent.type === 'MetaProperty'
  ) {
    return false;
  }
  return !parent.type.startsWith('Import');
}

/** Analyze lexical scopes of an AST tree. */
export function analyzeScope(root: Program | BaseNode): {
  rootScope: Scope;
  nodeToScope: Map<BaseNode, Scope>;
} {
  const rootScope = new Scope(root, null, false);
  const nodeToScope = new Map<BaseNode, Scope>();
  const scopeOwners = new Map<BaseNode, Scope>();
  const bindingIdentifiers = new Set<Identifier>();
  let currentScope = rootScope;
  nodeToScope.set(root, rootScope);

  walkAst(root, {
    enter(node, parent) {
      if (node.type === 'FunctionDeclaration') {
        const declaration = node as unknown as FunctionDeclaration;
        if (declaration.id !== null) {
          currentScope.registerBinding(
            declaration.id.name,
            'function',
            declaration.id,
            node,
          );
          bindingIdentifiers.add(declaration.id);
        }
      } else if (node.type === 'ClassDeclaration') {
        const declaration = node as unknown as ClassDeclaration;
        if (declaration.id !== null) {
          currentScope.registerBinding(
            declaration.id.name,
            'class',
            declaration.id,
            node,
          );
          bindingIdentifiers.add(declaration.id);
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

        const fnNode = node as { id?: Identifier | null; params?: Pattern[] };
        if (node.type === 'FunctionExpression' && fnNode.id) {
          fnScope.registerBinding(fnNode.id.name, 'function', fnNode.id, node);
          bindingIdentifiers.add(fnNode.id);
        }

        for (const param of fnNode.params ?? []) {
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
          const parameter = (node as unknown as CatchClause).param;
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
        const varDecl = node as VariableDeclaration;
        const targetScope =
          varDecl.kind === 'var'
            ? currentScope.getFunctionScope() ?? currentScope.getProgramScope()
            : currentScope;
        for (const decl of varDecl.declarations) {
          for (const id of extractPatternIdentifiers(decl.id)) {
            targetScope.registerBinding(id.name, varDecl.kind, id, node);
            bindingIdentifiers.add(id);
          }
        }
      }

      if (node.type === 'ImportDeclaration') {
        const programScope = currentScope.getProgramScope();
        const importDecl = node as { specifiers?: Array<{ local?: Identifier }> };
        for (const spec of importDecl.specifiers ?? []) {
          if (spec.local && isIdentifier(spec.local)) {
            programScope.registerBinding(spec.local.name, 'import', spec.local, node);
            bindingIdentifiers.add(spec.local);
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
        currentScope.getBinding(node.name)?.references.push(node);
      }
    },
    leave(node) {
      if (scopeOwners.get(node) === currentScope && currentScope.parent !== null) {
        currentScope = currentScope.parent;
      }
    },
  });

  return { rootScope, nodeToScope };
}
