/**
 * components/props.ts - component prop patterns and reactive replay builders.
 *
 * JSX always supplies named properties. This module normalizes supported
 * function parameters into either positional slots or one object envelope,
 * then emits assignments that replay defaults and destructuring after a prop
 * box update. It contains no runtime or component-placement policy.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode,
  extractPatternIdentifiers,
  walkAst,
  type BaseNode,
} from '../ast';
import { analyzeComponentPropShape } from './prop-shape';

export type ComponentParam = Exclude<
  t.FunctionDeclaration['params'][number],
  t.TSParameterProperty
>;
type PropTarget = t.Identifier | t.ObjectPattern | t.ArrayPattern;

function cloneCompilerNode<TNode extends t.Node>(node: TNode): TNode {
  return cloneNode(node as unknown as BaseNode) as unknown as TNode;
}

function isObjectProperty(node: t.Node): node is t.ObjectProperty {
  return astFactory.isObjectProperty(node) ||
    (node as unknown as BaseNode).type === 'Property';
}

function propertyName(node: t.Node): string | null {
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
 * rest properties, and generic `props` bindings retain the object
 * envelope so their authored JavaScript semantics stay exact.
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
  /** Compiler-owned replay used instead of assigning `source` to `target`. */
  replay?: t.Statement;
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

/** Initial locals for an entity factory whose inputs live in a props box. */
export function buildPropDeclaration(
  plan: ComponentPropsPlan,
  sources: t.Expression[],
): t.VariableDeclaration | null {
  if (plan.params.length === 0) return null;
  return astFactory.variableDeclaration(
    'let',
    plan.params.map((param, index) =>
      astFactory.variableDeclarator(
        declarationTarget(parameterTarget(param)),
        inputWithDefault(param, sources[index] ?? astFactory.identifier('undefined')),
      ),
    ),
  );
}

/** Replay original parameter semantics from new slot values. */
export function buildPropReplay(
  plan: ComponentPropsPlan,
  sources: t.Expression[],
): t.Statement[] {
  return plan.params.map((param, index) =>
    astFactory.expressionStatement(
      astFactory.assignmentExpression(
        '=',
        assignmentTarget(parameterTarget(param)),
        inputWithDefault(param, sources[index] ?? astFactory.identifier('undefined')),
      ),
    ),
  );
}

/** Assignment used by ordered body derivations such as `{ value } = props`. */
export function buildDerivationReplay(
  derivation: LocalDerivation,
): t.Statement {
  if (derivation.replay !== undefined) {
    return cloneCompilerNode(derivation.replay);
  }
  return astFactory.expressionStatement(
    astFactory.assignmentExpression(
      '=',
      assignmentTarget(derivation.target),
      cloneCompilerNode(derivation.source),
    ),
  );
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

function parameterTarget(param: ComponentParam): PropTarget {
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

/** Clone an authored parameter for emitted JavaScript factory syntax. */
export function runtimeParameter(param: ComponentParam): ComponentParam {
  const cloned = cloneCompilerNode(param);
  stripTypeSyntax(cloned);
  return cloned;
}

function inputWithDefault(
  param: ComponentParam,
  source: t.Expression,
): t.Expression {
  if (!astFactory.isAssignmentPattern(param)) return cloneCompilerNode(source);
  return astFactory.conditionalExpression(
    astFactory.binaryExpression(
      '===',
      cloneCompilerNode(source),
      astFactory.identifier('undefined'),
    ),
    cloneCompilerNode(param.right),
    cloneCompilerNode(source),
  );
}

function declarationTarget(target: PropTarget): PropTarget {
  const cloned = cloneCompilerNode(target);
  stripTypeSyntax(cloned);
  return cloned;
}

function assignmentTarget(target: PropTarget): PropTarget {
  const cloned = cloneCompilerNode(target);
  stripTypeSyntax(cloned);
  return cloned;
}

function stripTypeSyntax(node: t.Node): void {
  walkAst(node, {
    enter(current) {
      const typed = current as t.Node & {
        typeAnnotation?: t.TypeAnnotation | t.TSTypeAnnotation | null;
        optional?: boolean | null;
      };
      if ('typeAnnotation' in typed) typed.typeAnnotation = null;
      if ('optional' in typed) typed.optional = null;
    },
  });
}
