/** Authored component parameter contracts and lexical binding facts. */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode,
  extractPatternIdentifiers,
  type BaseNode,
} from '../ast';
import { analyzeComponentPropShape } from './prop-shape';

export type ComponentParam = Exclude<
  t.FunctionDeclaration['params'][number],
  t.TSParameterProperty
>;
export type PropTarget = t.Identifier | t.ObjectPattern | t.ArrayPattern;

function cloneCompilerNode<TNode extends t.Node>(node: TNode): TNode {
  return cloneNode(node as unknown as BaseNode) as unknown as TNode;
}

export function isObjectProperty(node: t.Node): node is t.ObjectProperty {
  return astFactory.isObjectProperty(node) ||
    (node as unknown as BaseNode).type === 'Property';
}

export function propertyName(node: t.Node): string | null {
  if (astFactory.isIdentifier(node)) return node.name;
  if (astFactory.isStringLiteral(node)) return node.value;
  if ((node as unknown as BaseNode).type !== 'Literal') return null;
  const value = (node as unknown as { value?: unknown }).value;
  return typeof value === 'string' ? value : null;
}

export interface ComponentPropsPlan {
  mode: 'positional' | 'object';
  /** JSX attribute names accepted by a closed declaration. */
  names: string[];
  /** Generic object bindings and object rest accept undeclared attributes. */
  acceptsUnknown: boolean;
  /** Source bindings introduced by the original parameter patterns. */
  bindings: string[];
  /** Original parameters retained by lightweight factories. */
  params: ComponentParam[];
  /** The sole object envelope has a whole-parameter default. */
  hasWholeDefault: boolean;
  /** Props consumed as compiler-owned mount slots rather than scalar values. */
  renderProps: string[];
  /** Props invoked by structural list sites as caller-owned row factories. */
  renderCallbacks: string[];
  /** Props consumed as DOM ref adapters and forwarded without reading a sink. */
  refProps: string[];
}

export interface SimpleObjectPropBinding {
  name: string;
  local: string;
}

/**
 * Closed `{ item, selected }`-style contracts can use positional arguments in
 * compiler-private lightweight row factories. Defaults, nested patterns,
 * rest properties, and unproven generic `props` bindings retain the object
 * envelope. Private single-field rows can be normalized before this pass by
 * components/private-row-props.ts once every envelope use and call is proven.
 */
export function simpleObjectPropBindings(
  plan: ComponentPropsPlan,
): SimpleObjectPropBinding[] | null {
  if (
    plan.mode !== 'object' ||
    plan.params.length !== 1 ||
    plan.hasWholeDefault
  ) {
    return null;
  }
  const param = plan.params[0]!;
  if (!astFactory.isObjectPattern(param)) return null;

  const bindings: SimpleObjectPropBinding[] = [];
  for (const property of param.properties) {
    if (
      !isObjectProperty(property) ||
      property.computed ||
      !astFactory.isIdentifier(property.value)
    ) {
      return null;
    }
    const name = propertyName(property.key);
    if (name === null) return null;
    bindings.push({ name, local: property.value.name });
  }
  return bindings;
}

export interface LocalDerivation {
  /** Declaration converted from const to let by component emission. */
  declaration: t.VariableDeclaration;
  /** Binding or destructuring pattern refreshed during update. */
  target: t.Identifier | t.ObjectPattern | t.ArrayPattern;
  /** Reactive expression evaluated again in source order. */
  source: t.Expression;
  /** Every binding introduced by target. */
  bindings: string[];
  /** Transitive non-derived roots that can change this value. */
  sources: string[];
  /**
   * Some reactive setup keeps its authored binding stable and only updates
   * the hidden value behind it. Fetch query rebinding is the first such
   * case: subscribers must keep the original resource identity.
   */
  stableTarget?: boolean;
  /** Stable source identity and authored call; a backend chooses its replay ABI. */
  replay?: { readonly kind: 'provider' | 'factory'; readonly call: t.CallExpression };
}

export interface ControlFlowDerivation {
  /** Pure authored control flow retained for initial factory evaluation. */
  statement: t.IfStatement | t.SwitchStatement;
  /** Mutable locals assigned by the control-flow calculation. */
  bindings: string[];
  /** Initializers restored before replay when the control flow is partial. */
  resets: Array<{
    binding: string;
    source: t.Expression;
  }>;
  /** Transitive non-derived roots that can change the calculation. */
  sources: string[];
}

/** Normalize a component's source parameters into its JSX call contract. */
export function analyzeComponentProps(
  params: t.FunctionDeclaration['params'],
): ComponentPropsPlan {
  const plain = params as ComponentParam[];
  const shape = analyzeComponentPropShape(
    plain as unknown as BaseNode[],
  );
  return {
    ...shape,
    params: plain.map(cloneCompilerNode),
    renderProps: [],
    renderCallbacks: [],
    refProps: [],
  };
}

/** All lexical bindings introduced by an identifier or destructuring pattern. */
export function bindingNames(node: t.LVal): string[] {
  return extractPatternIdentifiers(node as unknown as BaseNode).map(
    (identifier) => identifier.name,
  );
}

/** Generic object parameter binding, or null for an object pattern. */
export function objectBindingName(plan: ComponentPropsPlan): string | null {
  if (plan.mode !== 'object' || plan.params.length !== 1) return null;
  const target = parameterTarget(plan.params[0]!);
  return astFactory.isIdentifier(target) ? target.name : null;
}

/** Local identifier bound from one top-level object property. */
export function localBindingForProp(
  plan: ComponentPropsPlan,
  name: string,
): string | null {
  if (plan.mode === 'positional') {
    return plan.names.includes(name) ? name : null;
  }
  if (plan.params.length !== 1) return null;
  const target = parameterTarget(plan.params[0]!);
  if (!astFactory.isObjectPattern(target)) return null;
  for (const property of target.properties) {
    if (!isObjectProperty(property) || property.computed) continue;
    const declaredName = propertyName(property.key);
    if (declaredName !== name) continue;
    const value = astFactory.isAssignmentPattern(property.value)
      ? property.value.left
      : property.value;
    return astFactory.isIdentifier(value) ? value.name : null;
  }
  return null;
}

/** Declared prop name that introduced one local binding. */
export function propNameForBinding(
  plan: ComponentPropsPlan,
  binding: string,
): string | null {
  if (plan.mode === 'positional') {
    return plan.names.includes(binding) ? binding : null;
  }
  if (plan.params.length !== 1) return null;
  const target = parameterTarget(plan.params[0]!);
  if (!astFactory.isObjectPattern(target)) return null;
  for (const property of target.properties) {
    if (!isObjectProperty(property) || property.computed) continue;
    if (
      !bindingNames(property.value as t.LVal).includes(binding)
    ) {
      continue;
    }
    if (astFactory.isIdentifier(property.key)) return property.key.name;
    const declaredName = propertyName(property.key);
    if (declaredName !== null) return declaredName;
  }
  return null;
}

export function parameterTarget(param: ComponentParam): PropTarget {
  if (astFactory.isRestElement(param)) {
    throw new Error('rest component parameters are not supported');
  }
  const target = astFactory.isAssignmentPattern(param) ? param.left : param;
  if (
    !astFactory.isIdentifier(target) &&
    !astFactory.isObjectPattern(target) &&
    !astFactory.isArrayPattern(target)
  ) {
    throw new Error('unsupported component parameter target');
  }
  return target;
}
