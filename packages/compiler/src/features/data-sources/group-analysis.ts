/** Shared source and origin analysis for Group and TSRX boundaries. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {
  childNode,
  extractPatternIdentifiers,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Identifier as AstIdentifier,
} from '../../ast';
import {
  astBindingAt,
  type Ctx,
  type TransparentPresentationComponent,
} from '../../context';
import { isCallToImported } from './discovery';

export function jsxTagName(element: t.JSXElement): string | null {
  return astFactory.isJSXIdentifier(element.openingElement.name)
    ? element.openingElement.name.name
    : null;
}

function transparentSourceBindingName(
  ctx: Ctx,
  identifier: t.Identifier,
): string | null {
  const name = identifier.name;
  const binding = astBindingAt(
    ctx,
    identifier as unknown as BaseNode,
    name,
  );
  if (binding === undefined || !binding.references.includes(identifier as unknown as AstIdentifier)) {
    return null;
  }
  if (ctx.transparentModuleSources.has(name)) return name;
  const parent = ctx.astAnalysis?.parentByNode.get(binding.identifier) ?? null;
  if (parent?.type !== 'VariableDeclarator') return null;
  const init = childNode(parent, 'init');
  if (
    init === null ||
    !astFactory.isCallExpression(init as unknown as t.Node) ||
    !isCallToImported(
      ctx,
      identifier as unknown as BaseNode,
      init as unknown as t.Expression,
      ctx.transparentSourceFactories,
    )
  ) {
    return null;
  }
  return name;
}

export interface ComponentSourceProp {
  prop: string;
  source: string;
}

export function componentSourceProps(
  ctx: Ctx,
  element: t.JSXElement,
): ComponentSourceProp[] {
  const sources = new Map<string, string>();
  for (const attribute of element.openingElement.attributes) {
    if (
      !astFactory.isJSXAttribute(attribute) ||
      !astFactory.isJSXIdentifier(attribute.name) ||
      !astFactory.isJSXExpressionContainer(attribute.value) ||
      !astFactory.isIdentifier(attribute.value.expression)
    ) {
      continue;
    }
    const source = transparentSourceBindingName(ctx, attribute.value.expression);
    if (source !== null) sources.set(attribute.name.name, source);
  }
  return [...sources].map(([prop, source]) => ({ prop, source }));
}

function rejectGroupDataAttribute(
  element: t.JSXElement,
  errorAt: { buildCodeFrameError(message: string, at?: t.Node): Error },
): void {
  const data = element.openingElement.attributes.find((attribute) =>
    astFactory.isJSXAttribute(attribute) &&
    astFactory.isJSXIdentifier(attribute.name, { name: 'data' }),
  );
  if (data === undefined) return;
  throw errorAt.buildCodeFrameError(
    'memo-dom: Group infers colorless sources from its content; remove the data prop',
    data,
  );
}

export function inferredGroupDataNames(
  ctx: Ctx,
  element: t.JSXElement,
  content: BaseNode,
  errorAt: { buildCodeFrameError(message: string, at?: t.Node): Error },
): string[] {
  rejectGroupDataAttribute(element, errorAt);
  const candidates = new Set<string>();
  let component = ctx.astAnalysis?.parentByNode.get(element as unknown as BaseNode) ?? null;
  while (component !== null && component.type !== 'FunctionDeclaration') {
    component = ctx.astAnalysis?.parentByNode.get(component) ?? null;
  }
  if (component !== null) {
    const declaration = component as unknown as t.FunctionDeclaration;
    if (declaration.id !== null) {
      // Source discovery has already proven which component-local bindings are
      // colorless resources. Seed every one of those bindings here, then let
      // the origin walk below retain only the sources actually used by this
      // Group's content. Scanning only top-level references loses sources whose
      // first read occurs inside an immediately-evaluated callback, such as a
      // `projects.map(project => tasks.filter(...))` derivation.
      for (const source of ctx.transparentSources.get(declaration.id.name) ?? []) {
        candidates.add(source);
      }
      const linked = ctx.linkedComponentPropSources.get(declaration.id.name);
      const parameter = declaration.params[0];
      const transparentProps = new Set<string>();
      for (const [prop, origin] of linked ?? []) {
        if (origin.transparent) transparentProps.add(prop);
      }
      let program: BaseNode = component;
      while (ctx.astAnalysis?.parentByNode.get(program) !== null && ctx.astAnalysis?.parentByNode.get(program) !== undefined) {
        program = ctx.astAnalysis.parentByNode.get(program)!;
      }
      walkAst(program, {
        enter(node) {
          if (node.type !== 'JSXElement') return;
          const call = node as unknown as t.JSXElement;
          if (jsxTagName(call) !== declaration.id!.name) return;
          for (const attribute of call.openingElement.attributes) {
            if (
              !astFactory.isJSXAttribute(attribute) ||
              !astFactory.isJSXIdentifier(attribute.name) ||
              !astFactory.isJSXExpressionContainer(attribute.value) ||
              !astFactory.isIdentifier(attribute.value.expression)
            ) continue;
            if (transparentSourceBindingName(ctx, attribute.value.expression) !== null) {
              transparentProps.add(attribute.name.name);
            }
          }
        },
      });
      if (astFactory.isObjectPattern(parameter)) {
        for (const prop of transparentProps) {
          for (const property of parameter.properties) {
            if (
              astFactory.isObjectProperty(property) &&
              !property.computed &&
              astFactory.isIdentifier(property.key, { name: prop }) &&
              astFactory.isIdentifier(property.value)
            ) {
              candidates.add(property.value.name);
            }
          }
        }
      }
    }
    walkAst(component, {
      enter(node) {
        // Nested declarations are separate components/helpers. Function and
        // arrow expressions, however, can be immediately evaluated as part of
        // a render derivation (`items.map(() => otherSource.filter(...))`).
        // Keep walking those closures so every proven source is available to
        // the later content-origin filter.
        if (node !== component && node.type === 'FunctionDeclaration') {
          return false;
        }
        if (node.type !== 'Identifier') return;
        const source = transparentSourceBindingName(
          ctx,
          node as unknown as t.Identifier,
        );
        if (source !== null) candidates.add(source);
      },
    });
  }
  const origins = groupOrigins(ctx, element as unknown as BaseNode, [...candidates]);
  const used = [...expressionOrigins(ctx, content, origins)].sort();
  return used;
}

type GroupOrigins = Map<AstBinding, Set<string>>;

export function expressionOrigins(
  ctx: Ctx,
  root: BaseNode,
  origins: ReadonlyMap<AstBinding, ReadonlySet<string>>,
): Set<string> {
  const found = new Set<string>();
  const note = (identifier: AstIdentifier): void => {
    const binding = astBindingAt(ctx, identifier, identifier.name);
    if (binding === undefined || !binding.references.includes(identifier)) return;
    for (const source of origins.get(binding) ?? []) found.add(source);
  };
  walkAst(root, {
    enter(node) {
      if (node.type === 'Identifier') note(node as unknown as AstIdentifier);
    },
  });
  return found;
}

export function groupOrigins(
  ctx: Ctx,
  element: BaseNode,
  sources: readonly string[],
): GroupOrigins {
  const origins: GroupOrigins = new Map();
  for (const source of sources) {
    const binding = astBindingAt(ctx, element, source);
    if (binding !== undefined) origins.set(binding, new Set([source]));
  }
  let component = ctx.astAnalysis?.parentByNode.get(element) ?? null;
  while (component !== null && component.type !== 'FunctionDeclaration') {
    component = ctx.astAnalysis?.parentByNode.get(component) ?? null;
  }
  if (component === null) return origins;
  let changed = true;
  while (changed) {
    changed = false;
    walkAst(component, {
      enter(node) {
        if (node !== component && (
          node.type === 'ArrowFunctionExpression' ||
          node.type === 'FunctionExpression' ||
          node.type === 'FunctionDeclaration'
        )) return false;
        if (node.type !== 'VariableDeclarator') return undefined;
        const init = childNode(node, 'init');
        const pattern = childNode(node, 'id');
        if (init === null || pattern === null) return undefined;
        const dependencies = expressionOrigins(ctx, init, origins);
        if (dependencies.size === 0) return;
        for (const identifier of extractPatternIdentifiers(pattern)) {
          const binding = astBindingAt(ctx, identifier, identifier.name);
          if (binding === undefined) continue;
          const current = origins.get(binding) ?? new Set<string>();
          const before = current.size;
          for (const source of dependencies) current.add(source);
          origins.set(binding, current);
          changed ||= current.size !== before;
        }
        return undefined;
      },
    });
  }
  return origins;
}

export function isLoweredGroupExpression(expression: t.Expression): boolean {
  return (expression as t.Expression & {
    __memoDomTransparentGroup?: boolean;
  }).__memoDomTransparentGroup === true;
}

function componentPropName(attribute: t.JSXAttribute): string | null {
  return astFactory.isJSXIdentifier(attribute.name)
    ? attribute.name.name
    : null;
}

export function annotateGroupComponentCalls(
  ctx: Ctx,
  content: BaseNode,
  origins: ReadonlyMap<AstBinding, ReadonlySet<string>>,
  pending: string | TransparentPresentationComponent,
  error: string | TransparentPresentationComponent,
): void {
  const note = (node: BaseNode): void => {
    const element = node as unknown as t.JSXElement;
    const tag = jsxTagName(element);
    if (tag === null || !/^[A-Z]/.test(tag)) return;
    let policies = ctx.transparentGroupCallPolicies.get(element);
    policies ??= new Map();
    // A source-less component boundary still inherits the Group's nearest
    // presentation policy. The child may own its own colorless sources or
    // forward the policy through another component before one is created.
    if (!policies.has('$default')) {
      policies.set('$default', { pending, error });
    }
    for (const attribute of element.openingElement.attributes) {
      if (!astFactory.isJSXAttribute(attribute)) continue;
      const prop = componentPropName(attribute);
      const value = attribute.value;
      if (
        prop === null ||
        !astFactory.isJSXExpressionContainer(value)
      ) continue;
      const expression = value.expression;
      if (
        !astFactory.isIdentifier(expression) ||
        expressionOrigins(
          ctx,
          expression as unknown as BaseNode,
          origins,
        ).size === 0
      ) continue;
      // Inner groups run first (exit traversal) and own the nearest match.
      if (!policies.has(prop)) policies.set(prop, { pending, error });
    }
    ctx.transparentGroupCallPolicies.set(element, policies);
  };
  walkAst(content, {
    enter(node) {
      if (node.type === 'JSXElement') note(node);
    },
  });
}
