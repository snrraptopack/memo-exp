/** Finite authored JSX selections and lexical candidates, before lowering. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {lexicalBindingKey} from '../analysis/type-candidates';
import {childNode, childNodes, cloneNode as cloneAstNode, identifierLikeName as identifierName,
  nodeFields as fields, stringValue, walkAst, type BaseNode, type Binding, type ScopeAnalysis} from '../ast';
import {astBindingAt, attrExpr, memberKey, memberRootName, nodeHasJsx, type Ctx, type ComponentPath} from '../context';

export interface DynamicTagCandidate {
  readonly compare: t.Expression;
  readonly kind: 'intrinsic' | 'component';
  readonly name: string;
}
export type DynamicTagSite =
  | {readonly kind:'namespace'; readonly element:t.JSXElement}
  | {readonly kind:'selection'; readonly element:t.JSXElement; readonly selector:t.Expression;
      readonly candidates:readonly DynamicTagCandidate[]};
export interface DynamicTagPropMode {
  readonly component:string;
  readonly renderProps:readonly string[];
}
export interface DynamicTagPlan {
  readonly components:readonly {readonly path:ComponentPath; readonly hasJsx:boolean;
    readonly sites:readonly DynamicTagSite[]}[];
  readonly propModes:readonly DynamicTagPropMode[];
}
interface ProgramContainer {node:t.Program}
function cloneNode<TNode>(value:TNode):TNode {
  return cloneAstNode(value as unknown as BaseNode) as unknown as TNode;
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
    const left = childNode(current, 'left');
    const right = childNode(current, 'right');
    if (left !== null) {
      collectLocalComponentNames(ctx, left as unknown as t.Expression, output, visiting);
    }
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
  visiting = new Set<BaseNode>(),
): void {
  const current = unwrap(expression as unknown as BaseNode);
  if (visiting.has(current)) return;
  visiting.add(current);
  if (current.type === 'ConditionalExpression') {
    const consequent = childNode(current, 'consequent')!;
    const alternate = childNode(current, 'alternate')!;
    collectCandidates(ctx, at, consequent as unknown as t.Expression, output, visiting);
    collectCandidates(ctx, at, alternate as unknown as t.Expression, output, visiting);
    return;
  }
  if (current.type === 'LogicalExpression') {
    const left = childNode(current, 'left');
    const right = childNode(current, 'right');
    if (left !== null) {
      collectCandidates(ctx, at, left as unknown as t.Expression, output, visiting);
    }
    if (right !== null) {
      collectCandidates(ctx, at, right as unknown as t.Expression, output, visiting);
    }
    return;
  }
  const literal = stringValue(current);
  if (literal !== null) {
    output.push({
      compare: cloneNode(expression),
      kind: 'intrinsic', name: literal,
    });
    return;
  }
  const name = identifierName(current);
  if (name !== null) {
    if (ctx.comps.has(name) || ctx.importedComponents.has(name)) {
      output.push({ compare: cloneNode(expression), kind: 'component', name });
      return;
    }
    for (const candidate of ctx.stateTagCandidates.get(name) ?? []) {
      collectCandidates(ctx, at, astFactory.stringLiteral(candidate), output, visiting);
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
        visiting,
      );
    }
    const initializer = binding === undefined ? null : bindingInitializer(ctx, binding);
    if (initializer !== null) {
      collectCandidates(ctx, at, initializer as unknown as t.Expression, output, visiting);
    }
    return;
  }
  if (current.type === 'CallExpression') {
    const callee = identifierName(childNode(current, 'callee'));
    if (callee === null) return;
    for (const candidate of ctx.functionTagCandidates.get(callee) ?? []) {
      collectCandidates(ctx, at, astFactory.stringLiteral(candidate), output, visiting);
    }
    for (const returned of localFunctionReturns(ctx, at, callee)) {
      collectCandidates(ctx, at, returned, output, visiting);
    }
    for (const candidate of ctx.functionComponentCandidates.get(callee) ?? []) {
      collectCandidates(ctx, at, astFactory.identifier(candidate), output, visiting);
    }
    return;
  }
  if (current.type !== 'MemberExpression') return;
  const member = current as unknown as t.MemberExpression;
  const value = propertyValue(ctx, at, member);
  if (value !== null) {
    collectCandidates(ctx, at, value, output, visiting);
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
      collectCandidates(ctx, at, astFactory.identifier(candidate), output, visiting);
    }
  }
  for (const candidate of ctx.stateTagCandidates.get(root) ?? []) {
    collectCandidates(ctx, at, astFactory.stringLiteral(candidate), output, visiting);
  }
  for (const candidate of ctx.stateComponentCandidates.get(root) ?? []) {
    collectCandidates(ctx, at, astFactory.identifier(candidate), output, visiting);
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

function selectorName(selector: t.Expression): string {
  if (astFactory.isIdentifier(selector)) return selector.name;
  if (astFactory.isMemberExpression(selector)) {
    return memberKey(selector) ?? '<member expression>';
  }
  return '<expression>';
}

/** Capture source sites in child-before-parent order without AST mutation. */
export function planDynamicTags(ctx:Ctx):DynamicTagPlan {
  const propUsage = new Map<string,Map<string,{scalar:boolean;jsx:boolean;at:ComponentPath}>>();
  const components: Array<DynamicTagPlan['components'][number]> = [];
  for (const [, path] of ctx.compPaths) {
    const elements:t.JSXElement[] = [];
    walkAst<BaseNode>(path.node,{enter(node){
      if(node.type==='JSXElement')elements.push(node as unknown as t.JSXElement);
    }});
    const sites:DynamicTagSite[] = [];
    for(const element of elements.reverse()) {
      const name=element.openingElement.name;
      if(astFactory.isJSXNamespacedName(name)) {
        sites.push(Object.freeze({kind:'namespace',element}));continue;
      }
      if(astFactory.isJSXIdentifier(name) && (!/^[A-Z]/.test(name.name) ||
        ctx.comps.has(name.name) || ctx.importedComponents.has(name.name)))continue;
      const selector=jsxNameExpression(name);
      const candidates:DynamicTagCandidate[]=[];
      for(const initializer of bindingInitializers(ctx,element as unknown as BaseNode,selector)) {
        collectCandidates(ctx,element as unknown as BaseNode,initializer,candidates);
      }
      const unique=[...new Map(candidates.map(candidate=>[candidateKey(candidate),candidate])).values()];
      if(unique.length===0)throw path.buildCodeFrameError(
        `memo-dom: dynamic JSX tag '${selectorName(selector)}' has no finite string or linked-component candidates`);
      for(const candidate of unique) {
        const props=ctx.componentProps.get(candidate.name);
        if(props===undefined || props.renderProps.length===0)continue;
        let byProp=propUsage.get(candidate.name);
        if(byProp===undefined){byProp=new Map();propUsage.set(candidate.name,byProp);}
        for(const attribute of element.openingElement.attributes) {
          if(astFactory.isJSXSpreadAttribute(attribute) || !astFactory.isJSXIdentifier(attribute.name) ||
            !props.renderProps.includes(attribute.name.name))continue;
          const value=attrExpr(attribute.value);
          const usage=byProp.get(attribute.name.name) ?? {scalar:false,jsx:false,at:path};
          if(value!==null && nodeHasJsx(value))usage.jsx=true;else usage.scalar=true;
          byProp.set(attribute.name.name,usage);
        }
      }
      sites.push(Object.freeze({kind:'selection',element,selector,
        candidates:Object.freeze(unique.map(candidate=>Object.freeze(candidate)))}));
    }
    components.push(Object.freeze({path,hasJsx:elements.length>0,sites:Object.freeze(sites)}));
  }
  const propModes:DynamicTagPropMode[]=[];
  for(const [component,byProp] of propUsage) {
    const scalar=new Set<string>();
    for(const [prop,usage] of byProp) {
      if(usage.scalar && usage.jsx)throw usage.at.buildCodeFrameError(
        `memo-dom: dynamic component prop '${prop}' is used as both scalar data and JSX content`);
      if(usage.scalar)scalar.add(prop);
    }
    if(scalar.size>0)propModes.push(Object.freeze({component,
      renderProps:Object.freeze(ctx.componentProps.get(component)!.renderProps.filter(prop=>!scalar.has(prop)))}));
  }
  return Object.freeze({components:Object.freeze(components),propModes:Object.freeze(propModes)});
}

/** Publish source prop classification after successful target normalization. */
export function recordDynamicTagPropModes(ctx:Pick<Ctx,'componentProps'>,modes:readonly DynamicTagPropMode[]):void {
  for(const {component,renderProps} of modes)ctx.componentProps.get(component)!.renderProps=[...renderProps];
}
