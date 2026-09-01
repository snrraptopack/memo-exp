/**
 * identifiers.ts - compiler-wide lexical binding allocation.
 *
 * Source identifiers from every descendant scope are reserved so generated
 * outer bindings cannot be shadowed inside user callbacks. Allocation mirrors
 * Babel's historical UID sequence while remaining parser/scope independent.
 */

import * as t from '@babel/types';
import { toIdentifier, walkAst, type BaseNode } from './ast';

export class GeneratedIdentifiers {
  readonly runtimeId: string;
  readonly routerId: string;
  readonly dataRuntimeId: string;
  private readonly reserved = new Set<string>();
  private readonly componentIds = new Map<string, string>();

  constructor(program: BaseNode) {
    walkIdentifiers(program, (name) => this.reserved.add(name));
    this.runtimeId = this.generate('MD').name;
    this.routerId = this.generate('MR').name;
    this.dataRuntimeId = this.generate('MDD').name;
  }

  generate(hint: string): t.Identifier {
    const name = toIdentifier(hint).replace(/^_+/, '').replace(/\d+$/g, '');
    let index = 0;
    for (;;) {
      let candidate = `_${name}`;
      if (index >= 11) candidate += index - 1;
      else if (index >= 9) candidate += index - 9;
      else if (index >= 1) candidate += index + 1;
      index++;
      if (this.reserved.has(candidate)) continue;
      this.reserved.add(candidate);
      return t.identifier(candidate);
    }
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
  program: BaseNode,
): GeneratedIdentifiers {
  const identifiers = new GeneratedIdentifiers(program);
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

export function mr(owner: IdentifierOwner, name: string): t.MemberExpression {
  const identifiers = requireIdentifiers(owner);
  return t.memberExpression(
    t.identifier(identifiers.routerId),
    t.identifier(name),
  );
}

export function mdd(owner: IdentifierOwner, name: string): t.MemberExpression {
  const identifiers = requireIdentifiers(owner);
  return t.memberExpression(
    t.identifier(identifiers.dataRuntimeId),
    t.identifier(name),
  );
}

export function requireIdentifiers(owner: IdentifierOwner): GeneratedIdentifiers {
  if (owner.identifiers === null) {
    throw new Error('memo-dom: generated identifier allocator was not initialized');
  }
  return owner.identifiers;
}

function walkIdentifiers(root: BaseNode, visit: (name: string) => void): void {
  walkAst(root, {
    enter(node) {
      if (node.type !== 'Identifier') return;
      const name = (node as unknown as { name?: unknown }).name;
      if (typeof name === 'string') visit(name);
    },
  });
}
