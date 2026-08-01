/**
 * components/props.ts - component prop patterns and reactive replay builders.
 *
 * JSX always supplies named properties. This module normalizes supported
 * function parameters into either positional slots or one object envelope,
 * then emits assignments that replay defaults and destructuring after a prop
 * box update. It contains no runtime or component-placement policy.
 */

import * as t from '@babel/types';

export type ComponentParam = Exclude<
  t.FunctionDeclaration['params'][number],
  t.TSParameterProperty
>;
type PropTarget = t.Identifier | t.ObjectPattern | t.ArrayPattern;

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
  if (!t.isObjectPattern(param)) return null;

  const bindings: SimpleObjectPropBinding[] = [];
  for (const property of param.properties) {
    if (
      !t.isObjectProperty(property) ||
      property.computed ||
      !t.isIdentifier(property.value)
    ) {
      return null;
    }
    const name = t.isIdentifier(property.key)
      ? property.key.name
      : t.isStringLiteral(property.key)
        ? property.key.value
        : null;
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
  if (params.some((param) => t.isTSParameterProperty(param))) {
    throw new Error('TypeScript parameter properties are not valid component props');
  }
  const plain = params as ComponentParam[];
  if (plain.length === 0) {
    return {
      mode: 'positional',
      names: [],
      acceptsUnknown: false,
      bindings: [],
      params: [],
      hasWholeDefault: false,
      renderProps: [],
      renderCallbacks: [],
      refProps: [],
    };
  }

  const firstTarget = parameterTarget(plain[0]!);
  const objectMode =
    plain.length === 1 &&
    (t.isObjectPattern(firstTarget) ||
      (t.isIdentifier(firstTarget) && firstTarget.name === 'props'));

  if (objectMode) {
    const names = t.isObjectPattern(firstTarget)
      ? objectPropertyNames(firstTarget)
      : [];
    return {
      mode: 'object',
      names,
      acceptsUnknown:
        t.isIdentifier(firstTarget) ||
        firstTarget.properties.some((property) => t.isRestElement(property)),
      bindings: bindingNames(firstTarget),
      params: plain.map((param) => t.cloneNode(param)),
      hasWholeDefault: t.isAssignmentPattern(plain[0]),
      renderProps: [],
      renderCallbacks: [],
      refProps: [],
    };
  }

  const names: string[] = [];
  for (const param of plain) {
    const target = parameterTarget(param);
    if (!t.isIdentifier(target)) {
      throw new Error(
        'object-destructured props must be the component\'s only parameter',
      );
    }
    names.push(target.name);
  }
  return {
    mode: 'positional',
    names,
    acceptsUnknown: false,
    bindings: plain.flatMap((param) => bindingNames(parameterTarget(param))),
    params: plain.map((param) => t.cloneNode(param)),
    hasWholeDefault: false,
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
  return t.variableDeclaration(
    'let',
    plan.params.map((param, index) =>
      t.variableDeclarator(
        declarationTarget(parameterTarget(param)),
        inputWithDefault(param, sources[index] ?? t.identifier('undefined')),
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
    t.expressionStatement(
      t.assignmentExpression(
        '=',
        assignmentTarget(parameterTarget(param)),
        inputWithDefault(param, sources[index] ?? t.identifier('undefined')),
      ),
    ),
  );
}

/** Assignment used by ordered body derivations such as `{ value } = props`. */
export function buildDerivationReplay(
  derivation: LocalDerivation,
): t.Statement {
  return t.expressionStatement(
    t.assignmentExpression(
      '=',
      assignmentTarget(derivation.target),
      t.cloneNode(derivation.source),
    ),
  );
}

/** All lexical bindings introduced by an identifier or destructuring pattern. */
export function bindingNames(node: t.LVal): string[] {
  return Object.keys(t.getBindingIdentifiers(node));
}

/** Generic object parameter binding, or null for an object pattern. */
export function objectBindingName(plan: ComponentPropsPlan): string | null {
  if (plan.mode !== 'object' || plan.params.length !== 1) return null;
  const target = parameterTarget(plan.params[0]!);
  return t.isIdentifier(target) ? target.name : null;
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
  if (!t.isObjectPattern(target)) return null;
  for (const property of target.properties) {
    if (!t.isObjectProperty(property) || property.computed) continue;
    const propertyName = t.isIdentifier(property.key)
      ? property.key.name
      : t.isStringLiteral(property.key)
        ? property.key.value
        : null;
    if (propertyName !== name) continue;
    const value = t.isAssignmentPattern(property.value)
      ? property.value.left
      : property.value;
    return t.isIdentifier(value) ? value.name : null;
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
  if (!t.isObjectPattern(target)) return null;
  for (const property of target.properties) {
    if (!t.isObjectProperty(property) || property.computed) continue;
    if (
      !Object.keys(t.getBindingIdentifiers(property.value)).includes(binding)
    ) {
      continue;
    }
    if (t.isIdentifier(property.key)) return property.key.name;
    if (t.isStringLiteral(property.key)) return property.key.value;
  }
  return null;
}

function parameterTarget(param: ComponentParam): PropTarget {
  if (t.isRestElement(param)) {
    throw new Error('rest component parameters are not supported');
  }
  const target = t.isAssignmentPattern(param) ? param.left : param;
  if (
    !t.isIdentifier(target) &&
    !t.isObjectPattern(target) &&
    !t.isArrayPattern(target)
  ) {
    throw new Error('unsupported component parameter target');
  }
  return target;
}

/** Clone an authored parameter for emitted JavaScript factory syntax. */
export function runtimeParameter(param: ComponentParam): ComponentParam {
  const cloned = t.cloneNode(param);
  stripTypeSyntax(cloned);
  return cloned;
}

function inputWithDefault(
  param: ComponentParam,
  source: t.Expression,
): t.Expression {
  if (!t.isAssignmentPattern(param)) return t.cloneNode(source);
  return t.conditionalExpression(
    t.binaryExpression(
      '===',
      t.cloneNode(source),
      t.identifier('undefined'),
    ),
    t.cloneNode(param.right),
    t.cloneNode(source),
  );
}

function objectPropertyNames(pattern: t.ObjectPattern): string[] {
  const names: string[] = [];
  for (const property of pattern.properties) {
    if (t.isRestElement(property)) continue;
    if (property.computed) {
      throw new Error('computed keys are not supported in component prop patterns');
    }
    if (t.isIdentifier(property.key)) names.push(property.key.name);
    else if (t.isStringLiteral(property.key)) names.push(property.key.value);
    else {
      throw new Error('component prop pattern keys must be identifiers or strings');
    }
  }
  return names;
}

function declarationTarget(target: PropTarget): PropTarget {
  const cloned = t.cloneNode(target);
  stripTypeSyntax(cloned);
  return cloned;
}

function assignmentTarget(target: PropTarget): PropTarget {
  const cloned = t.cloneNode(target);
  stripTypeSyntax(cloned);
  return cloned;
}

function stripTypeSyntax(node: t.Node): void {
  const typed = node as t.Node & {
    typeAnnotation?: t.TypeAnnotation | t.TSTypeAnnotation | null;
    optional?: boolean | null;
  };
  if ('typeAnnotation' in typed) typed.typeAnnotation = null;
  if ('optional' in typed) typed.optional = null;
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const child = (node as any)[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && 'type' in item) {
          stripTypeSyntax(item as t.Node);
        }
      }
    } else if (child && typeof child === 'object' && 'type' in child) {
      stripTypeSyntax(child as t.Node);
    }
  }
}
