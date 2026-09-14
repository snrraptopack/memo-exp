/** Finite dynamic JSX tag lowering over parser-neutral AST metadata. */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { lexicalBindingKey } from '../analysis/type-candidates';
import {
  analyzeScope,
  childNode,
  childNodes,
  cloneNode as cloneAstNode,
  identifierLikeName as identifierName,
  isValidIdentifier as isValidEstreeIdentifier,
  nodeFields as fields,
  replaceNode,
  stringValue,
  walkAst,
  type BaseNode,
  type Binding,
  type ScopeAnalysis,
} from '../ast';
import {
  astBindingAt,
  attrExpr,
  memberKey,
  memberRootName,
  nodeHasJsx,
  refreshAstAnalysis,
  type ComponentPath,
  type Ctx,
} from '../context';
import type { ComponentPropsPlan } from '../components/props';
import { generatedIdentifier } from '../identifiers';

interface DynamicTagCandidate {
  compare: t.Expression;
  tag: t.JSXIdentifier;
}

interface ProgramContainer {
  node: t.Program;
}

function cloneNode<TNode>(value: TNode): TNode {
  return cloneAstNode(value as unknown as BaseNode) as unknown as TNode;
}

function fail(at: ComponentPath, message: string): never {
  throw at.buildCodeFrameError(message);
}

function linkedComponentPlan(
  component: Ctx['importedComponents'] extends Map<string, infer Value>
    ? Value
    : never,
): ComponentPropsPlan {
  return {
    mode: component.objectProps ? 'object' : 'positional',
    names: [...component.props],
    acceptsUnknown: component.acceptsUnknownProps,
    bindings: [],
    params: [],
    hasWholeDefault: component.hasWholeDefault,
    renderProps: [...(component.renderProps ?? [])],
    renderCallbacks: [...(component.renderCallbacks ?? [])],
    refProps: [...(component.refProps ?? [])],
  };
}

/** Install finite linked component candidates before ordinary import analysis. */
export function installLinkedDynamicComponentImports(
  ctx: Ctx,
  programPath: ProgramContainer,
): void {
  if (ctx.linkedDynamicComponentCandidates.size === 0) return;
  const program = programPath.node as unknown as BaseNode;
  const occupied = new Set(analyzeScope(program).rootScope.bindings.keys());
  const existingByKey = new Map(
    [...ctx.importedComponents].map(([local, component]) => [
      component.key,
      local,
    ]),
  );
  const declarations: t.ImportDeclaration[] = [];

  for (const [owner, candidates] of ctx.linkedDynamicComponentCandidates) {
    const locals: string[] = [];
    for (const candidate of candidates) {
      let local = existingByKey.get(candidate.key);
      if (local === undefined) {
        const base = `MDDynamic_${candidate.imported.replace(
          /[^A-Za-z0-9_$]/g,
          '_',
        )}`;
        local = base;
        let index = 1;
        while (occupied.has(local)) local = `${base}${index++}`;
        occupied.add(local);
        existingByKey.set(candidate.key, local);

        const component = {
          type: 'component' as const,
          key: candidate.key,
          props: [...candidate.props],
          objectProps: candidate.objectProps,
          acceptsUnknownProps: candidate.acceptsUnknownProps,
          hasWholeDefault: candidate.hasWholeDefault,
          listLightweight: candidate.listLightweight,
          delegatedEvents: candidate.delegatedEvents,
          renderProps: [...(candidate.renderProps ?? [])],
          renderCallbacks: [...(candidate.renderCallbacks ?? [])],
          refProps: [...(candidate.refProps ?? [])],
          subtreeReads: [...(candidate.subtreeReads ?? [])],
        };
        ctx.importedComponents.set(local, component);
        ctx.componentProps.set(local, linkedComponentPlan(component));
        declarations.push(
          astFactory.importDeclaration(
            candidate.imported === 'default'
              ? [astFactory.importDefaultSpecifier(astFactory.identifier(local))]
              : [
                  astFactory.importSpecifier(
                    astFactory.identifier(local),
                    isValidEstreeIdentifier(candidate.imported)
                      ? astFactory.identifier(candidate.imported)
                      : astFactory.stringLiteral(candidate.imported),
                  ),
                ],
            astFactory.stringLiteral(candidate.source),
          ),
        );
      }
      locals.push(local);
    }
    const unique = [...new Set(locals)];
    if (ctx.state.has(owner)) ctx.stateComponentCandidates.set(owner, unique);
    else ctx.functionComponentCandidates.set(owner, unique);
  }
  ctx.header.push(...declarations);
}

function unwrap(expression: BaseNode): BaseNode {
  let current = expression;
  while (
    current.type === 'TSAsExpression' ||
    current.type === 'TSTypeAssertion' ||
    current.type === 'TSNonNullExpression'
  ) {
    const inner = childNode(current, 'expression');
    if (inner === null) break;
    current = inner;
  }
  return current;
}

function jsxNameExpression(
  name: t.JSXIdentifier | t.JSXMemberExpression,
): t.Expression {
  if (astFactory.isJSXIdentifier(name)) return astFactory.identifier(name.name);
  return astFactory.memberExpression(
    jsxNameExpression(name.object),
    astFactory.identifier(name.property.name),
  );
}

function bindingDeclarator(
  analysis: ScopeAnalysis,
  binding: Binding,
): BaseNode | null {
  let current: BaseNode | null = binding.identifier;
  while (current !== null && current !== binding.declarationNode) {
    if (current.type === 'VariableDeclarator') return current;
    current = analysis.parentByNode.get(current) ?? null;
  }
  return null;
}

function bindingInitializer(ctx: Ctx, binding: Binding): BaseNode | null {
  const declaration = bindingDeclarator(ctx.astAnalysis!, binding);
  return declaration === null ? null : childNode(declaration, 'init');
}

function propertyValue(
  ctx: Ctx,
  at: BaseNode,
  expression: t.MemberExpression,
): t.Expression | null {
  const key = memberKey(expression);
  if (key === null) return null;
  const [root, ...segments] = key.split('.');
  if (root === undefined || segments.length === 0) return null;
  const binding = astBindingAt(ctx, at, root);
  if (binding === undefined) return null;
  let current = bindingInitializer(ctx, binding);
  if (current === null) return null;

  for (const segment of segments) {
    current = unwrap(current);
    if (current.type !== 'ObjectExpression') return null;
    const property = childNodes(current, 'properties').find((candidate) => {
      if (
        (candidate.type !== 'ObjectProperty' && candidate.type !== 'Property') ||
        fields(candidate).computed === true
      ) {
        return false;
      }
      return (
        identifierName(childNode(candidate, 'key')) ??
        stringValue(childNode(candidate, 'key'))
      ) === segment;
    });
    if (property === undefined) return null;
    current = childNode(property, 'value');
    if (current === null) return null;
  }
  return current as unknown as t.Expression;
}

function functionReturnExpressions(fn: BaseNode): t.Expression[] {
  const body = childNode(fn, 'body');
  if (body === null) return [];
  if (body.type !== 'BlockStatement') {
    return [body as unknown as t.Expression];
  }
  const returns: t.Expression[] = [];
  walkAst<BaseNode>(body, {
    enter(current) {
      if (current !== body && (
        current.type === 'FunctionDeclaration' ||
        current.type === 'FunctionExpression' ||
        current.type === 'ArrowFunctionExpression'
      )) {
        return false;
      }
      if (current.type !== 'ReturnStatement') return;
      const argument = childNode(current, 'argument');
      if (argument !== null) returns.push(argument as unknown as t.Expression);
      return false;
    },
  });
  return returns;
}

function localFunctionReturns(
  ctx: Ctx,
  at: BaseNode,
  name: string,
): t.Expression[] {
  const binding = astBindingAt(ctx, at, name);
  if (binding === undefined) return [];
  const candidate =
    binding.declarationNode.type === 'FunctionDeclaration'
      ? binding.declarationNode
      : bindingInitializer(ctx, binding);
  return candidate !== null && (
    candidate.type === 'FunctionDeclaration' ||
    candidate.type === 'FunctionExpression' ||
    candidate.type === 'ArrowFunctionExpression'
  )
    ? functionReturnExpressions(candidate)
    : [];
}

function collectLocalComponentNames(
  ctx: Ctx,
  expression: t.Expression,
  output: Set<string>,
  visiting = new Set<BaseNode>(),
): void {
  const current = unwrap(expression as unknown as BaseNode);
  if (visiting.has(current)) return;
  visiting.add(current);
  const name = identifierName(current);
  if (name !== null) {
    if (ctx.comps.has(name) || ctx.importedComponents.has(name)) {
      output.add(name);
      return;
    }
    for (const candidate of ctx.stateComponentCandidates.get(name) ??
      ctx.functionComponentCandidates.get(name) ?? []) {
      output.add(candidate);
    }
    return;
  }
  if (current.type === 'ConditionalExpression') {
    const consequent = childNode(current, 'consequent');
    const alternate = childNode(current, 'alternate');
    if (consequent !== null) {
      collectLocalComponentNames(ctx, consequent as unknown as t.Expression, output, visiting);
    }
    if (alternate !== null) {
      collectLocalComponentNames(ctx, alternate as unknown as t.Expression, output, visiting);
    }
    return;
  }
  if (current.type === 'LogicalExpression') {
    const right = childNode(current, 'right');
    if (right !== null) {
      collectLocalComponentNames(ctx, right as unknown as t.Expression, output, visiting);
    }
    return;
  }
  if (current.type === 'ObjectExpression') {
    for (const property of childNodes(current, 'properties')) {
      const value = childNode(property, 'value');
      if (value !== null) {
        collectLocalComponentNames(ctx, value as unknown as t.Expression, output, visiting);
      }
    }
    return;
  }
  if (current.type === 'ArrayExpression') {
    for (const element of childNodes(current, 'elements')) {
      if (element.type !== 'SpreadElement') {
        collectLocalComponentNames(ctx, element as unknown as t.Expression, output, visiting);
      }
    }
    return;
  }
  if (current.type === 'CallExpression') {
    const callee = identifierName(childNode(current, 'callee'));
    if (callee !== null) {
      for (const candidate of ctx.functionComponentCandidates.get(callee) ?? []) {
        output.add(candidate);
      }
    }
    return;
  }
  if (current.type === 'MemberExpression') {
    const root = memberRootName(current as unknown as t.MemberExpression);
    if (root !== null) {
      for (const candidate of ctx.stateComponentCandidates.get(root) ?? []) {
        output.add(candidate);
      }
    }
  }
}

/** Discover local component registries/helper returns before tag lowering. */
export function scanLocalDynamicComponentCandidates(
  ctx: Ctx,
  programPath: ProgramContainer,
): void {
  for (const statement of programPath.node.body) {
    const declaration = astFactory.isExportNamedDeclaration(statement)
      ? statement.declaration
      : statement;
    if (!astFactory.isVariableDeclaration(declaration)) continue;
    for (const declarator of declaration.declarations) {
      if (!astFactory.isIdentifier(declarator.id) || declarator.init == null) continue;
      const output = new Set<string>();
      collectLocalComponentNames(ctx, declarator.init, output);
      if (output.size > 0 && ctx.state.has(declarator.id.name)) {
        ctx.stateComponentCandidates.set(declarator.id.name, [...output]);
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, helperPath] of ctx.helpers) {
      const output = new Set(ctx.functionComponentCandidates.get(name) ?? []);
      for (const expression of functionReturnExpressions(
        helperPath.node as unknown as BaseNode,
      )) {
        collectLocalComponentNames(ctx, expression, output);
      }
      if (
        output.size > 0 &&
        output.size !== (ctx.functionComponentCandidates.get(name)?.length ?? 0)
      ) {
        ctx.functionComponentCandidates.set(name, [...output]);
        changed = true;
      }
    }
  }
}

function collectCandidates(
  ctx: Ctx,
  at: BaseNode,
  expression: t.Expression,
  output: DynamicTagCandidate[],
  onError: (message: string) => never,
  visiting = new Set<BaseNode>(),
): void {
  const current = unwrap(expression as unknown as BaseNode);
  if (visiting.has(current)) return;
  visiting.add(current);
  if (current.type === 'ConditionalExpression') {
    const consequent = childNode(current, 'consequent')!;
    const alternate = childNode(current, 'alternate')!;
    collectCandidates(ctx, at, consequent as unknown as t.Expression, output, onError, visiting);
    collectCandidates(ctx, at, alternate as unknown as t.Expression, output, onError, visiting);
    return;
  }
  const literal = stringValue(current);
  if (literal !== null) {
    if (!/^[A-Za-z][A-Za-z0-9:_-]*$/.test(literal)) {
      onError(`memo-dom: '${literal}' is not a valid dynamic intrinsic tag name`);
    }
    output.push({
      compare: cloneNode(expression),
      tag: astFactory.jsxIdentifier(literal),
    });
    return;
  }
  const name = identifierName(current);
  if (name !== null) {
    if (ctx.comps.has(name) || ctx.importedComponents.has(name)) {
      output.push({ compare: cloneNode(expression), tag: astFactory.jsxIdentifier(name) });
      return;
    }
    for (const candidate of ctx.stateTagCandidates.get(name) ?? []) {
      collectCandidates(ctx, at, astFactory.stringLiteral(candidate), output, onError, visiting);
    }
    const binding = astBindingAt(ctx, at, name);
    const bindingKey = binding === undefined
      ? null
      : lexicalBindingKey(binding.identifier);
    for (const candidate of binding === undefined
      ? []
      : bindingKey === null
      ? []
      : ctx.bindingTagCandidates.get(bindingKey) ?? []) {
      collectCandidates(
        ctx,
        at,
        astFactory.stringLiteral(candidate),
        output,
        onError,
        visiting,
      );
    }
    const initializer = binding === undefined ? null : bindingInitializer(ctx, binding);
    if (initializer !== null) {
      collectCandidates(ctx, at, initializer as unknown as t.Expression, output, onError, visiting);
    }
    return;
  }
  if (current.type === 'CallExpression') {
    const callee = identifierName(childNode(current, 'callee'));
    if (callee === null) return;
    for (const candidate of ctx.functionTagCandidates.get(callee) ?? []) {
      collectCandidates(ctx, at, astFactory.stringLiteral(candidate), output, onError, visiting);
    }
    for (const returned of localFunctionReturns(ctx, at, callee)) {
      collectCandidates(ctx, at, returned, output, onError, visiting);
    }
    for (const candidate of ctx.functionComponentCandidates.get(callee) ?? []) {
      collectCandidates(ctx, at, astFactory.identifier(candidate), output, onError, visiting);
    }
    return;
  }
  if (current.type !== 'MemberExpression') return;
  const member = current as unknown as t.MemberExpression;
  const value = propertyValue(ctx, at, member);
  if (value !== null) {
    collectCandidates(ctx, at, value, output, onError, visiting);
    return;
  }
  const root = memberRootName(member);
  if (root === null) return;
  const binding = astBindingAt(ctx, at, root);
  const initializer = binding === undefined ? null : bindingInitializer(ctx, binding);
  if (initializer !== null) {
    const localComponents = new Set<string>();
    collectLocalComponentNames(ctx, initializer as unknown as t.Expression, localComponents);
    for (const candidate of localComponents) {
      collectCandidates(ctx, at, astFactory.identifier(candidate), output, onError, visiting);
    }
  }
  for (const candidate of ctx.stateTagCandidates.get(root) ?? []) {
    collectCandidates(ctx, at, astFactory.stringLiteral(candidate), output, onError, visiting);
  }
  for (const candidate of ctx.stateComponentCandidates.get(root) ?? []) {
    collectCandidates(ctx, at, astFactory.identifier(candidate), output, onError, visiting);
  }
}

function candidateKey(candidate: DynamicTagCandidate): string {
  const literal = stringValue(candidate.compare as unknown as BaseNode);
  if (literal !== null) return `string:${literal}`;
  const name = identifierName(candidate.compare as unknown as BaseNode);
  return name === null
    ? JSON.stringify(candidate.compare)
    : `component:${name}`;
}

function functionOwner(ctx: Ctx, at: BaseNode): BaseNode {
  let current: BaseNode | null = at;
  while (current !== null) {
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression' ||
      current.type === 'ArrowFunctionExpression' ||
      current.type === 'Program'
    ) {
      return current;
    }
    current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  }
  return ctx.astAnalysis!.rootScope.block;
}

function bindingInitializers(
  ctx: Ctx,
  at: BaseNode,
  selector: t.Expression,
): t.Expression[] {
  if (astFactory.isIdentifier(selector)) {
    const binding = astBindingAt(ctx, at, selector.name);
    if (binding === undefined) return [];
    const initial = bindingInitializer(ctx, binding);
    return [
      ...(initial === null ? [] : [initial as unknown as t.Expression]),
      ...binding.constantViolations.flatMap((violation) => {
        if (
          violation.type === 'AssignmentExpression' &&
          fields(violation).operator === '='
        ) {
          const right = childNode(violation, 'right');
          return right === null ? [] : [right as unknown as t.Expression];
        }
        return [];
      }),
    ];
  }
  if (!astFactory.isMemberExpression(selector)) return [];
  const initial = propertyValue(ctx, at, selector);
  const key = memberKey(selector);
  const assignments: t.Expression[] = [];
  if (key !== null) {
    walkAst<BaseNode>(functionOwner(ctx, at), {
      enter(current) {
        if (
          current.type !== 'AssignmentExpression' ||
          fields(current).operator !== '='
        ) {
          return;
        }
        const left = childNode(current, 'left');
        const right = childNode(current, 'right');
        if (
          left?.type === 'MemberExpression' &&
          memberKey(left as unknown as t.MemberExpression) === key &&
          right !== null
        ) {
          assignments.push(right as unknown as t.Expression);
        }
      },
    });
  }
  return [...(initial === null ? [] : [initial]), ...assignments];
}

function cloneWithTag(
  element: t.JSXElement,
  tag: t.JSXIdentifier,
): t.JSXElement {
  const clone = cloneNode(element);
  clone.openingElement.name = cloneNode(tag);
  if (clone.closingElement != null) clone.closingElement.name = cloneNode(tag);
  return clone;
}

function finiteSelection(
  ctx: Ctx,
  selector: t.Expression,
  element: t.JSXElement,
  candidates: DynamicTagCandidate[],
): t.Expression {
  // The selection becomes a cond-region pick that re-evaluates on every
  // update. Evaluate the selector once per pick through a shared scratch
  // binding instead of re-running it inside every candidate comparison.
  const scratch =
    ctx.dynamicTagSelector ??
    (ctx.dynamicTagSelector = generatedIdentifier(
      ctx,
      'dynamicTagSelector',
    ).name);
  if (ctx.header.every((node) => !isDynamicTagScratchDecl(node, scratch))) {
    ctx.header.push(
      astFactory.variableDeclaration('let', [
        astFactory.variableDeclarator(astFactory.identifier(scratch)),
      ]),
    );
  }
  let selection: t.Expression = astFactory.nullLiteral();
  for (let index = candidates.length - 1; index >= 0; index--) {
    const candidate = candidates[index]!;
    const selected = astFactory.identifier(scratch);
    selection = astFactory.conditionalExpression(
      astFactory.binaryExpression(
        '===',
        index === 0
          ? astFactory.assignmentExpression(
              '=',
              selected,
              cloneNode(selector),
            )
          : selected,
        cloneNode(candidate.compare),
      ),
      cloneWithTag(element, candidate.tag),
      selection,
    );
  }
  return selection;
}

function isDynamicTagScratchDecl(node: t.Statement, name: string): boolean {
  return (
    astFactory.isVariableDeclaration(node) &&
    node.declarations.some(
      (declaration) =>
        astFactory.isIdentifier(declaration.id) &&
        declaration.id.name === name,
    )
  );
}

function selectorName(selector: t.Expression): string {
  if (astFactory.isIdentifier(selector)) return selector.name;
  if (astFactory.isMemberExpression(selector)) {
    return memberKey(selector) ?? '<member expression>';
  }
  return '<expression>';
}

/** Lower dynamic identifier/member JSX names before component validation. */
export function normalizeDynamicTags(ctx: Ctx): void {
  const propUsage = new Map<
    string,
    Map<string, { scalar: boolean; jsx: boolean; at: ComponentPath }>
  >();
  const program = ctx.astAnalysis!.rootScope.block;
  for (const [, componentPath] of ctx.compPaths) {
    const component = componentPath.node as unknown as BaseNode;
    const elements: BaseNode[] = [];
    walkAst<BaseNode>(component, {
      enter(current) {
        if (current.type === 'JSXElement') elements.push(current);
      },
    });
    for (const elementNode of elements.reverse()) {
      const element = elementNode as unknown as t.JSXElement;
      const name = element.openingElement.name;
      if (astFactory.isJSXNamespacedName(name)) {
        fail(componentPath, 'memo-dom: namespaced JSX tags are not supported');
      }
      if (
        astFactory.isJSXIdentifier(name) &&
        (!/^[A-Z]/.test(name.name) ||
          ctx.comps.has(name.name) ||
          ctx.importedComponents.has(name.name))
      ) {
        continue;
      }

      const selector = jsxNameExpression(name);
      const candidates: DynamicTagCandidate[] = [];
      for (const initializer of bindingInitializers(ctx, elementNode, selector)) {
        collectCandidates(
          ctx,
          elementNode,
          initializer,
          candidates,
          (message) => fail(componentPath, message),
        );
      }
      const unique = [
        ...new Map(
          candidates.map((candidate) => [candidateKey(candidate), candidate]),
        ).values(),
      ];
      if (unique.length === 0) {
        fail(
          componentPath,
          `memo-dom: dynamic JSX tag '${selectorName(selector)}' has no finite string or linked-component candidates`,
        );
      }
      for (const candidate of unique) {
        const plan = ctx.componentProps.get(candidate.tag.name);
        if (plan === undefined || plan.renderProps.length === 0) continue;
        let byProp = propUsage.get(candidate.tag.name);
        if (byProp === undefined) {
          byProp = new Map();
          propUsage.set(candidate.tag.name, byProp);
        }
        for (const attribute of element.openingElement.attributes) {
          if (
            astFactory.isJSXSpreadAttribute(attribute) ||
            !astFactory.isJSXIdentifier(attribute.name) ||
            !plan.renderProps.includes(attribute.name.name)
          ) {
            continue;
          }
          const value = attrExpr(attribute.value);
          const usage = byProp.get(attribute.name.name) ?? {
            scalar: false,
            jsx: false,
            at: componentPath,
          };
          if (value !== null && nodeHasJsx(value)) usage.jsx = true;
          else usage.scalar = true;
          byProp.set(attribute.name.name, usage);
        }
      }
      const replacement =
        unique.length === 1
          ? cloneWithTag(element, unique[0]!.tag)
          : astFactory.jsxFragment(
              astFactory.jsxOpeningFragment(),
              astFactory.jsxClosingFragment(),
              [
                astFactory.jsxExpressionContainer(
                  finiteSelection(ctx, selector, element, unique),
                ),
              ],
            );
      replaceNode(
        ctx.astAnalysis!,
        elementNode,
        replacement as unknown as BaseNode,
      );
    }
    if (elements.length > 0) refreshAstAnalysis(ctx, program);
  }
  for (const [component, byProp] of propUsage) {
    const plan = ctx.componentProps.get(component)!;
    for (const [prop, usage] of byProp) {
      if (usage.scalar && usage.jsx) {
        fail(
          usage.at,
          `memo-dom: dynamic component prop '${prop}' is used as both scalar data and JSX content`,
        );
      }
      if (usage.scalar) {
        plan.renderProps = plan.renderProps.filter(
          (candidate) => candidate !== prop,
        );
      }
    }
  }
}
