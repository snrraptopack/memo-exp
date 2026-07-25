/**
 * identifiers.ts - compiler-wide lexical binding allocation.
 *
 * Every compiler-owned binding is reserved through one Babel Program scope.
 * Source identifiers from descendant scopes are also reserved so generated
 * outer bindings cannot be shadowed inside user callbacks.
 */

import type { NodePath, Scope } from '@babel/traverse';
import * as t from '@babel/types';

export class GeneratedIdentifiers {
  readonly runtimeId: string;
  private readonly reserved = new Set<string>();
  private readonly componentIds = new Map<string, string>();

  constructor(private readonly scope: Scope, programPath: NodePath<t.Program>) {
    walkIdentifiers(programPath.node, (name) => this.reserved.add(name));
    this.runtimeId = this.generate('MD').name;
  }

  generate(hint: string): t.Identifier {
    let id: t.Identifier;
    do {
      id = this.scope.generateUidIdentifier(hint);
    } while (this.reserved.has(id.name));
    this.reserved.add(id.name);
    return id;
  }

  registerComponentId(component: string, id: string): void {
    this.componentIds.set(component, id);
  }

  componentId(component: string): t.Identifier {
    const id = this.componentIds.get(component);
    if (id === undefined) {
      throw new Error(`memo-dom: missing generated factory id for '${component}'`);
    }
    return t.identifier(id);
  }

  runtimeMember(name: string): t.MemberExpression {
    return t.memberExpression(
      t.identifier(this.runtimeId),
      t.identifier(name),
    );
  }
}

export interface IdentifierOwner {
  identifiers: GeneratedIdentifiers | null;
}

export function initializeGeneratedIdentifiers(
  owner: IdentifierOwner,
  programPath: NodePath<t.Program>,
): GeneratedIdentifiers {
  const identifiers = new GeneratedIdentifiers(programPath.scope, programPath);
  owner.identifiers = identifiers;
  return identifiers;
}

export function generatedIdentifier(
  owner: IdentifierOwner,
  hint: string,
): t.Identifier {
  return requireIdentifiers(owner).generate(hint);
}

export function componentId(
  owner: IdentifierOwner,
  component: string,
): t.Identifier {
  return requireIdentifiers(owner).componentId(component);
}

export function md(owner: IdentifierOwner, name: string): t.MemberExpression {
  return requireIdentifiers(owner).runtimeMember(name);
}

export function requireIdentifiers(owner: IdentifierOwner): GeneratedIdentifiers {
  if (owner.identifiers === null) {
    throw new Error('memo-dom: generated identifier allocator was not initialized');
  }
  return owner.identifiers;
}

function walkIdentifiers(root: t.Node, visit: (name: string) => void): void {
  const walk = (node: t.Node): void => {
    if (t.isIdentifier(node)) visit(node.name);
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const child = (node as any)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && 'type' in item) {
            walk(item as t.Node);
          }
        }
      } else if (child && typeof child === 'object' && 'type' in child) {
        walk(child as t.Node);
      }
    }
  };
  walk(root);
}
