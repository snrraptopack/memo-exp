/**
 * Exact-source attribution for JSX slot expressions.
 *
 * A slot may skip re-evaluation on an update whose dirty reasons name none of
 * its sources. That is only sound when every reactive read in the expression
 * is a source the owner's handlers report exactly (instance state, props, or
 * derivations rooted in them). Anything else — module state, transparent
 * sources, opaque locals, unsummarized calls, mutations — returns null and the
 * slot stays unconditional, exactly as before.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { walkAst } from '../ast';

/** Semantic inputs only: no runtime reasons, generated IDs or emission state. */
export interface ExpressionSourceEnvironment {
  readonly ownerSources: ReadonlySet<string>;
  readonly unknownSources: ReadonlySet<string>;
  readonly derivedSources: ReadonlyMap<string, readonly string[] | null>;
  readonly pureCallee: (callee: t.Node) => boolean;
}

export interface ComponentExpressionSources {
  /** Empty means no exact reactive sources; null means attribution is unknown. */
  readonly sourcesFor: (expression: t.Expression) => readonly string[] | null;
}

/** Capture source facts once; queries also accept combined/cloned JSX text. */
export function createExpressionSourceFacts(
  environment: ExpressionSourceEnvironment,
): ComponentExpressionSources {
  const ownerSources = new Set(environment.ownerSources);
  const unknownSources = new Set(environment.unknownSources);
  const derivedSources = new Map([...environment.derivedSources].map(([name, sources]) =>
    [name, sources === null ? null : Object.freeze([...sources])] as const));
  const facts = { ownerSources, unknownSources, derivedSources, pureCallee: environment.pureCallee };
  return { sourcesFor: expression => expressionSources(facts, expression) };
}

/** Root sources read by `expression`, or null when not exactly attributable. */
function expressionSources(
  environment: ExpressionSourceEnvironment,
  expression: t.Expression,
): readonly string[] | null {
  const roots = new Set<string>();
  let exact = true;
  const bail = (): false => {
    exact = false;
    return false;
  };

  walkAst<t.Node>(expression, { enter(node, parent) {
    if (!exact) return false;
    switch (node.type) {
      case 'AssignmentExpression':
      case 'UpdateExpression':
      case 'AwaitExpression':
      case 'YieldExpression':
      case 'NewExpression':
      case 'TaggedTemplateExpression':
      case 'JSXElement':
      case 'JSXFragment':
        return bail();
      case 'CallExpression':
      case 'OptionalCallExpression': {
        const callee = (node as t.CallExpression).callee;
        // A call is attributable only when its callee is visible to the
        // helper summarizer, or is rooted in an unbound global. In particular,
        // `obj.method()` must not inherit `obj`'s reason: the opaque method may
        // read state that is unrelated to the receiver.
        if (!environment.pureCallee(callee)) {
          return bail();
        }
        return undefined;
      }
      case 'Identifier': {
        if (!isValueReference(node as t.Identifier, parent)) return undefined;
        const name = (node as t.Identifier).name;
        if (environment.unknownSources.has(name)) {
          return bail();
        }
        const upstream = environment.derivedSources.get(name);
        if (upstream !== undefined) {
          if (upstream === null) return bail();
          for (const root of upstream) roots.add(root);
        } else if (environment.ownerSources.has(name)) {
          roots.add(name);
        }
        return undefined;
      }
      default:
        return undefined;
    }
  } });
  return exact ? [...roots].sort() : null;
}

/** Identifier positions that read a value (not property keys or labels). */
function isValueReference(node: t.Identifier, parent: t.Node | null): boolean {
  if (parent === null) return true;
  if (
    (astFactory.isMemberExpression(parent) ||
      astFactory.isOptionalMemberExpression(parent)) &&
    parent.property === node &&
    !parent.computed
  ) {
    return false;
  }
  if (
    astFactory.isObjectProperty(parent) &&
    parent.key === node &&
    !parent.computed
  ) {
    return false;
  }
  return true;
}
