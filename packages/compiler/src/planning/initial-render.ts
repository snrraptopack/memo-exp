/**
 * Initial content and browser execution are separate compiler products.
 * This first proof covers closed, deterministic component composition. Unknown
 * code stays in the browser; planning never executes an authored function.
 */
import {
  childNode, childNodes, identifierLikeName, isFunctionNode, nodeField,
  stringValue, analyzeScope, walkAst, type BaseNode, type Program, type ScopeAnalysis,
} from '../ast';
import { normalizeJsxText } from '../components/children';
import { nodeHasJsx, type MapCallExpression } from '../context';
import { analyzeComponentPropShape } from '../components/prop-shape';
import { combineTextExpressions } from '../components/text-expression';
import * as astFactory from '../ast/factory';
import type * as t from '../ast/compiler-types';
import { planConditionalBranches } from '../jsx/conditional-plan';
import { planListCallback } from '../lists/callback-plan';

export type InitialRenderNode =
  | { readonly kind: 'text'; readonly value: string; readonly live?: boolean }
  | { readonly kind: 'browser'; readonly id: number; readonly site: string }
  | { readonly kind: 'component'; readonly site: string; readonly moduleId: string; readonly callModuleId: string; readonly component: string;
      readonly children: readonly InitialRenderNode[]; readonly static?: boolean }
  | { readonly kind: 'conditional'; readonly site: string; readonly branch: number;
      readonly children: readonly InitialRenderNode[] }
  | { readonly kind: 'list'; readonly site: string; readonly rows: readonly (readonly InitialRenderNode[])[] }
  | { readonly kind: 'element'; readonly tag: string;
      readonly site?: string;
      readonly attributes: readonly InitialRenderAttribute[];
      readonly children: readonly InitialRenderNode[] };

export interface InitialRenderAttribute {
  readonly name: string;
  readonly value: string | number | boolean | null | undefined;
  readonly site?: string;
  readonly live?: boolean;
}

export interface BrowserRequirement {
  readonly moduleId: string;
  readonly kind: 'event' | 'ref' | 'lifecycle' | 'unknown';
  readonly detail: string;
}

export type InitialRenderPlan =
  | { readonly kind: 'html'; readonly target: string;
      readonly mountModuleId: string; readonly nodes: readonly InitialRenderNode[]; readonly exposedMutableValues?: true }
  | { readonly kind: 'mixed'; readonly target: string; readonly mountModuleId: string;
      readonly rootModuleId: string; readonly rootLocal: string; readonly returnSite: string;
      readonly nodes: readonly InitialRenderNode[];
      readonly regions: readonly { readonly id: number; readonly site: string }[] }
  | { readonly kind: 'bindings'; readonly target: string; readonly mountModuleId: string;
      readonly rootModuleId: string; readonly rootLocal: string; readonly returnSite: string;
      readonly nodes: readonly InitialRenderNode[]; readonly exposedMutableValues?: true }
  | { readonly kind: 'browser'; readonly requirements: readonly BrowserRequirement[] };

type Value = string | number | boolean | null | undefined | ValueObject | ValueArray | Component | Content;
interface ValueArray { readonly kind: 'array'; readonly items: readonly Value[] }
interface ValueObject { readonly kind: 'object'; readonly fields: ReadonlyMap<string, Value>; readonly props?: boolean; readonly live?: ReadonlySet<string> }
interface Component { readonly kind: 'component'; readonly node: BaseNode; readonly scope: Scope; readonly local?: string }
interface Content { readonly kind: 'content'; readonly nodes: readonly InitialRenderNode[] }
interface Scope { readonly moduleId: string; readonly values: Map<string, Value>; readonly unstable: Set<string>; readonly rootRender?: boolean }
interface ModuleScope extends Scope { readonly exports: Map<string, Value>; readonly unstableExports: Set<string> }

/** Authored source identity survives backend AST cloning. */
export function initialSite(node: BaseNode): string {
  return node.loc ? `${node.loc.start.line}:${node.loc.start.column}` : '';
}

class NeedsBrowser extends Error {
  constructor(readonly requirement: BrowserRequirement) { super(requirement.detail); }
}

/** Fail closed for unknown effects, host behavior, coercions and dependencies. */
export function planInitialRendering(
  programs: ReadonlyMap<string, Program>,
  root: { readonly mountModuleId: string; readonly moduleId: string; readonly local: string } | undefined,
  resolveImport: (importer: string, specifier: string) => string | undefined,
  runtimePath: string,
): InitialRenderPlan {
  function need(scope: Scope, detail: string, kind: BrowserRequirement['kind'] = 'unknown'): never {
    throw new NeedsBrowser({ moduleId: scope.moduleId, kind, detail });
  }
  const modules = new Map<string, ModuleScope>();
  const visiting = new Set<string>();
  const rendering = new Set<Component>();
  const analyses = new Map<string, ScopeAnalysis>();
  let mixed = false;
  let bindings = false;
  let bindingEvents = false;
  let bindingEventCount = 0;
  let returnSite: string | undefined;
  const regions: { id: number; site: string }[] = [];
  let target: string | undefined;
  let inStructure = false;

  function list(node: BaseNode, scope: Scope): Value | undefined {
    const callee = childNode(node, 'callee');
    if (callee?.type !== 'MemberExpression' || nodeField(callee, 'computed') ||
        identifierLikeName(childNode(callee, 'property')) !== 'map') return undefined;
    const input = expression(childNode(callee, 'object'), scope);
    if (input === null || typeof input !== 'object' || input.kind !== 'array') return undefined;
    if (bindings && inStructure) need(scope, 'Nested list bindings need a placement proof');
    const fn=childNodes(node,'arguments')[0];
    if (fn && (nodeField(fn,'async') || nodeField(fn,'generator'))) need(scope,'Async list callbacks need browser execution');
    const callback = planListCallback(node as MapCallExpression, message => need(scope, message));
    if (!callback.jsx || input.items.length>0 && (callback.prelude.length || bindings && callback.itemPattern.type !== 'Identifier')) {
      need(scope, 'Initial lists need a closed JSX row callback');
    }
    const previous = inStructure;
    inStructure = true;
    try {
      const keys = new Set<Value>();
      const rows = input.items.map((item, index) => {
        const row: Scope = {...scope, values: new Map(scope.values), unstable: new Set(scope.unstable)};
        bind(callback.itemPattern, item, row);
        if (callback.indexParam) row.values.set(callback.indexParam, index);
        if (bindings) {
          row.unstable.add(callback.itemParam);
          if (callback.indexParam) row.unstable.add(callback.indexParam);
        }
        const opening = childNode(callback.jsx!, 'openingElement')!;
        const key = childNodes(opening, 'attributes').find(attribute =>
          identifierLikeName(childNode(attribute, 'name')) === 'key');
        const value = key && childNode(key, 'value');
        const identity = value ? expression(value.type === 'JSXExpressionContainer' ? childNode(value, 'expression') : value, row) : item;
        if (keys.has(identity)) need(scope, 'Duplicate initial list keys need browser diagnostics');
        keys.add(identity);
        return jsx(callback.jsx!, row);
      });
      if (!bindings) return {kind: 'content', nodes: rows.flat()};
      if (rows.some(row => row.length !== 1 || row[0]?.kind !== 'element')) need(scope, 'Initial lists need one host root per row');
      return {kind: 'content', nodes: [{kind: 'list', site: initialSite(node), rows}]};
    } finally { inStructure = previous; }
  }

  function conditional(node: BaseNode, scope: Scope): Value {
    if (inStructure) need(scope, 'Nested structural bindings need a placement proof');
    const site = initialSite(node);
    if (!site) need(scope, 'Initial conditional placement needs authored source identity');
    const plan = planConditionalBranches(node as t.ConditionalExpression | t.LogicalExpression, {
      buildCodeFrameError(message) { return new NeedsBrowser({moduleId: scope.moduleId, kind: 'unknown', detail: message}); },
    });
    const branch = primitive(expression(plan.pickExpr, scope), scope);
    if (typeof branch !== 'number') need(scope, 'Initial conditional needs a closed selector');
    inStructure = true;
    try {
      const alternatives = plan.branches.map(input => {
        if (input === null) return [];
        if (!astFactory.isJSXElement(input)) need(scope, 'Structural fragment bindings need a placement proof');
        return jsx(input, scope);
      });
      return {kind: 'content', nodes: [{kind: 'conditional', site, branch, children: alternatives[branch] ?? []}]};
    } finally { inStructure = false; }
  }

  function primitive(value: Value, scope: Scope): string | number | boolean | null | undefined {
    if (value !== null && typeof value === 'object') need(scope, 'Object coercion needs browser execution');
    return value;
  }

  function expression(node: BaseNode | null, scope: Scope): Value {
    if (node === null) return undefined;
    if (isFunctionNode(node)) return { kind: 'component', node, scope, local: identifierLikeName(childNode(node,'id')) ?? undefined };
    switch (node.type) {
      case 'Literal': case 'StringLiteral': case 'NumericLiteral': case 'BooleanLiteral': case 'NullLiteral': {
        const value = node.type === 'NullLiteral' ? null : nodeField(node, 'value');
        if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value as Value;
        return need(scope, 'Unsupported literal');
      }
      case 'Identifier': {
        const name = identifierLikeName(node)!;
        if (!scope.values.has(name)) return need(scope, `Unknown value '${name}'`);
        if (mixed && scope.unstable.has(name)) return need(scope, `Captured writes to '${name}' require browser execution`);
        return scope.values.get(name);
      }
      case 'UnaryExpression': {
        const value = primitive(expression(childNode(node, 'argument'), scope), scope);
        switch (nodeField(node, 'operator')) {
          case '!': return !value;
          case '+': return Number(value);
          case '-': return -Number(value);
          case '~': return ~Number(value);
          case 'typeof': return typeof value;
          case 'void': return undefined;
          default: return need(scope, 'Unsupported unary operation');
        }
      }
      case 'BinaryExpression': {
        const left = primitive(expression(childNode(node, 'left'), scope), scope);
        const right = primitive(expression(childNode(node, 'right'), scope), scope);
        // Only primitives reach these operators: no user coercion hooks run.
        switch (nodeField(node, 'operator')) {
          case '+': return typeof left === 'string' || typeof right === 'string'
            ? String(left) + String(right) : Number(left) + Number(right);
          case '-': return Number(left) - Number(right);
          case '*': return Number(left) * Number(right);
          case '/': return Number(left) / Number(right);
          case '%': return Number(left) % Number(right);
          case '**': return Number(left) ** Number(right);
          case '===': return left === right;
          case '!==': return left !== right;
          case '==': return left == right;
          case '!=': return left != right;
          case '<': return typeof left === 'string' && typeof right === 'string' ? left < right : Number(left) < Number(right);
          case '<=': return typeof left === 'string' && typeof right === 'string' ? left <= right : Number(left) <= Number(right);
          case '>': return typeof left === 'string' && typeof right === 'string' ? left > right : Number(left) > Number(right);
          case '>=': return typeof left === 'string' && typeof right === 'string' ? left >= right : Number(left) >= Number(right);
          case '|': return Number(left) | Number(right);
          case '&': return Number(left) & Number(right);
          case '^': return Number(left) ^ Number(right);
          case '<<': return Number(left) << Number(right);
          case '>>': return Number(left) >> Number(right);
          case '>>>': return Number(left) >>> Number(right);
          default: return need(scope, 'Unsupported binary operation');
        }
      }
      case 'TSAsExpression': case 'TSSatisfiesExpression': case 'TSNonNullExpression': case 'ParenthesizedExpression':
        return expression(childNode(node, 'expression'), scope);
      case 'ObjectExpression': {
        const fields = new Map<string, Value>();
        for (const property of childNodes(node, 'properties')) {
          if (property.type !== 'Property' || nodeField(property, 'computed') ||
              nodeField(property, 'kind') !== 'init' || nodeField(property, 'method')) {
            return need(scope, 'Object spreads, getters and methods need browser execution');
          }
          const key = childNode(property, 'key');
          const name = identifierLikeName(key) ?? stringValue(key);
          if (name === null) return need(scope, 'Unknown object key');
          if (name === '__proto__') return need(scope, 'Prototype initialization needs browser execution');
          fields.set(name, expression(childNode(property, 'value'), scope));
        }
        return { kind: 'object', fields };
      }
      case 'ArrayExpression': {
        const elements = nodeField(node, 'elements') as (BaseNode | null)[];
        if (elements.some(item => item === null || item.type === 'SpreadElement')) need(scope, 'Sparse arrays and spreads need an initial iteration proof');
        return {kind: 'array', items: elements.map(item => expression(item, scope))};
      }
      case 'MemberExpression': {
        const object = expression(childNode(node, 'object'), scope);
        const name = nodeField(node, 'computed')
          ? primitive(expression(childNode(node, 'property'), scope), scope)
          : identifierLikeName(childNode(node, 'property'));
        if (object === null || typeof object !== 'object' || object.kind !== 'object' || typeof name !== 'string') {
          return need(scope, 'Member reads outside closed props need browser execution');
        }
        if (mixed && !object.props) return need(scope, 'Object mutation and escape need an interaction proof');
        if (mixed && object.live?.has(name)) return need(scope, 'Live prop reads require browser updates');
        if (!object.fields.has(name) && name in Object.prototype) return need(scope, 'Inherited property read needs browser execution');
        return object.fields.get(name);
      }
      case 'ConditionalExpression':
        if (bindings && nodeHasJsx(node)) return conditional(node, scope);
        if (mixed && scope.rootRender && nodeHasJsx(node)) need(scope, 'Root structural regions need a placement proof');
        return expression(childNode(node, primitive(expression(childNode(node, 'test'), scope), scope)
          ? 'consequent' : 'alternate'), scope);
      case 'LogicalExpression': {
        if (bindings && nodeHasJsx(node)) return conditional(node, scope);
        if (mixed && scope.rootRender && nodeHasJsx(node)) need(scope, 'Root structural regions need a placement proof');
        const left = expression(childNode(node, 'left'), scope);
        const value = primitive(left, scope);
        const operator = nodeField(node, 'operator');
        if (operator === '&&') return value ? expression(childNode(node, 'right'), scope) : left;
        if (operator === '||') return value ? left : expression(childNode(node, 'right'), scope);
        if (operator === '??') return value == null ? expression(childNode(node, 'right'), scope) : left;
        return need(scope, 'Unknown logical operator');
      }
      case 'TemplateLiteral': {
        const parts = childNodes(node, 'quasis');
        const inputs = childNodes(node, 'expressions');
        let text = '';
        for (let index = 0; index < parts.length; index++) {
          const cooked = (nodeField(parts[index]!, 'value') as { cooked?: unknown }).cooked;
          if (typeof cooked !== 'string') return need(scope, 'Invalid template text');
          text += cooked;
          if (index < inputs.length) text += String(primitive(expression(inputs[index]!, scope), scope));
        }
        return text;
      }
      case 'JSXElement': case 'JSXFragment': return { kind: 'content', nodes: jsx(node, scope) };
      case 'CallExpression': {
        const mapped = list(node, scope);
        if (mapped) return mapped;
        const name = identifierLikeName(childNode(node, 'callee'));
        const lifecycle = ['$effect', '$cleanup', 'effect', 'cleanup'].includes(name ?? '');
        return need(scope, lifecycle ? 'Lifecycle work requires a browser owner' : 'Calls need browser execution',
          lifecycle ? 'lifecycle' : 'unknown');
      }
      default: return need(scope, `${node.type} needs browser execution`);
    }
  }

  function bind(pattern: BaseNode | null, value: Value, scope: Scope): void {
    if (pattern?.type === 'Identifier') {
      const name = identifierLikeName(pattern)!;
      scope.values.set(name, value && typeof value==='object' && value.kind==='component' && !value.local ? {...value,local:name} : value);
      // A wholly closed page has no browser writes. Build capture/write facts
      // only when proving static content in a graph that retains interactivity.
      let analysis = analyses.get(scope.moduleId);
      if ((mixed || bindings) && !analysis) {
        analysis = analyzeScope(programs.get(scope.moduleId)!);
        analyses.set(scope.moduleId, analysis);
      }
      const binding = analysis?.nodeToScope.get(pattern)?.getBinding(name);
      if (binding?.constantViolations.length) scope.unstable.add(name);
      else scope.unstable.delete(name);
      return;
    }
    if (pattern?.type === 'AssignmentPattern') {
      bind(childNode(pattern, 'left'), value === undefined
        ? expression(childNode(pattern, 'right'), scope) : value, scope);
      return;
    }
    if (pattern?.type === 'ObjectPattern' && value !== null && typeof value === 'object' && value.kind === 'object') {
      for (const property of childNodes(pattern, 'properties')) {
        if (property.type !== 'Property' || nodeField(property, 'computed')) need(scope, 'Unknown prop binding');
        const key = identifierLikeName(childNode(property, 'key')) ?? stringValue(childNode(property, 'key'));
        if (key === null) need(scope, 'Unknown prop key');
        bind(childNode(property, 'value'), value.fields.get(key), scope);
        if (value.live?.has(key)) markLive(childNode(property,'value'),scope);
      }
      return;
    }
    need(scope, 'Unknown binding pattern');
  }

  function markLive(pattern: BaseNode | null, scope: Scope): void {
    if (pattern?.type==='Identifier') scope.unstable.add(identifierLikeName(pattern)!);
    else if (pattern?.type==='AssignmentPattern') markLive(childNode(pattern,'left'),scope);
    else if (pattern?.type==='ObjectPattern') for(const property of childNodes(pattern,'properties')) markLive(childNode(property,'value'),scope);
  }

  // Use the same closed-value proof with captured writes enabled. Unknown
  // object reads remain live. Both branches must be safe, even when the initial
  // value chooses only one; future source writes can choose another branch.
  function staysClosed(node: BaseNode | null, scope: Scope): boolean {
    const previous = mixed;
    mixed = true;
    try {
      const value = expression(node, scope);
      if (value !== null && typeof value === 'object') return false;
      let safe = true;
      if (node) walkAst<BaseNode>(node, { enter(input) {
        if (input.type === 'ConditionalExpression' || input.type === 'LogicalExpression') {
          for (const key of ['test', 'consequent', 'alternate', 'left', 'right']) {
            const branch = childNode(input, key);
            if (branch) expression(branch, scope);
          }
        }
        if (isFunctionNode(input)) safe = false;
      } });
      return safe;
    } catch (error) {
      if (!(error instanceof NeedsBrowser)) throw error;
      return false;
    } finally { mixed = previous; }
  }

  function declarations(node: BaseNode, scope: Scope): void {
    for (const declaration of childNodes(node, 'declarations')) {
      const init = childNode(declaration, 'init');
      if ((mixed || bindings) && scope.rootRender && init && nodeHasJsx(init)) need(scope, 'Root setup content needs a placement proof');
      const live = bindings && !staysClosed(init, scope);
      const pattern = childNode(declaration, 'id');
      bind(pattern, expression(init, scope), scope);
      if (live && pattern) walkAst<BaseNode>(pattern, { enter(input) {
        if (input.type === 'Identifier') scope.unstable.add(identifierLikeName(input)!);
      } });
    }
  }

  function content(value: Value, scope: Scope): readonly InitialRenderNode[] {
    if (value !== null && typeof value === 'object') {
      if (value.kind === 'content') return value.nodes;
      return need(scope, 'Non-content object child');
    }
    return value == null || typeof value === 'boolean' ? [] : [{ kind: 'text', value: String(value) }];
  }

  function render(component: Component, props: ReadonlyMap<string, Value>, rootCall = false, live: ReadonlySet<string> = new Set()): readonly InitialRenderNode[] {
    if (rendering.has(component)) need(component.scope, 'Recursive component composition');
    if (nodeField(component.node, 'async') || nodeField(component.node, 'generator')) need(component.scope, 'Async component');
    rendering.add(component);
    const scope: Scope = { moduleId: component.scope.moduleId, values: new Map(component.scope.values),
      unstable: new Set(component.scope.unstable), rootRender: rootCall };
    try {
      const params = childNodes(component.node, 'params');
      const shape = analyzeComponentPropShape(params);
      if (shape.mode === 'object' && params[0]) {
        bind(params[0], rootCall || !props.size && shape.hasWholeDefault
          ? undefined : { kind: 'object', fields: props, props: true, live }, scope);
      } else {
        for (let index = 0; index < params.length; index++) {
          bind(params[index]!, rootCall ? undefined : props.get(shape.names[index]!), scope);
          if (live.has(shape.names[index]!)) markLive(params[index]!,scope);
        }
      }
      const body = childNode(component.node, 'body');
      let result: readonly InitialRenderNode[] | undefined;
      if (body?.type !== 'BlockStatement') {
        if ((mixed || bindings) && rootCall && body) {
          if (!['JSXElement', 'JSXFragment'].includes(body.type)) need(scope, 'Mixed roots need a direct JSX return');
          returnSite = initialSite(body);
          if (!returnSite) need(scope, 'Initial placement needs authored source identity');
        }
        result = content(expression(body, scope), scope);
      }
      else {
        for (const statement of childNodes(body, 'body')) {
          if (statement.type === 'VariableDeclaration') declarations(statement, scope);
          else if (statement.type === 'FunctionDeclaration') bind(childNode(statement, 'id'), expression(statement, scope), scope);
          else if (statement.type === 'ReturnStatement') {
            const argument = childNode(statement, 'argument');
            if ((mixed || bindings) && rootCall && argument) {
              if (!['JSXElement', 'JSXFragment'].includes(argument.type)) need(scope, 'Mixed roots need a direct JSX return');
              returnSite = initialSite(argument);
              if (!returnSite) need(scope, 'Initial placement needs authored source identity');
            }
            result = content(expression(argument, scope), scope); break;
          }
          else if (statement.type !== 'EmptyStatement') {
            if (statement.type === 'ExpressionStatement') expression(childNode(statement, 'expression'), scope);
            need(scope, 'Component setup needs browser execution');
          }
        }
      }
      return result ?? need(scope, 'Component has no closed return');
    } finally { rendering.delete(component); }
  }

  function jsx(node: BaseNode, scope: Scope): readonly InitialRenderNode[] {
    function children(): InitialRenderNode[] {
      const result: InitialRenderNode[] = [];
      const pending: t.Expression[] = [];
      function flush(): void {
        if (!pending.length) return;
        const joined=combineTextExpressions(pending);
        const value=primitive(expression(joined,scope),scope);
        if (bindings) {
          const live = !staysClosed(joined, scope);
          if (astFactory.isStringLiteral(joined) && joined.value === '') need(scope,'Empty static text needs an HTML representation proof');
          const text = value == null || typeof value === 'boolean' ? '' : String(value);
          result.push({kind:'text',value:text,live});
        } else result.push(...content(value,scope));
        pending.length = 0;
      }
      for (const child of childNodes(node, 'children')) {
        if (child.type === 'JSXText') {
          const text = normalizeJsxText(String(nodeField(child, 'value')));
          if (text) pending.push(astFactory.stringLiteral(text));
          continue;
        }
        if (child.type === 'JSXExpressionContainer') {
          const input = childNode(child, 'expression');
          if (input?.type === 'JSXEmptyExpression') continue;
          if (input?.type === 'Identifier' && nodeField(input, 'name') === 'undefined') continue;
          if (input && (nodeField(input, 'value') === null || typeof nodeField(input, 'value') === 'boolean')) continue;
          const value = expression(input, scope);
          if (value !== null && typeof value === 'object' || input && nodeHasJsx(input)) {
            flush();
            result.push(...content(value, scope));
          } else { primitive(value,scope); pending.push(input as t.Expression); }
          continue;
        }
        flush();
        result.push(...jsx(child, scope));
      }
      flush();
      return result;
    }
    if (node.type === 'JSXFragment') {
      if (bindings) need(scope,'Fragment bindings need a placement proof');
      return children();
    }
    if (node.type !== 'JSXElement') return need(scope, 'Unknown JSX child');
    const opening = childNode(node, 'openingElement')!;
    const tag = identifierLikeName(childNode(opening, 'name'));
    if (tag === null) return need(scope, 'Dynamic tag needs browser execution');
    const host = /^[a-z]/.test(tag);
    const props = new Map<string, Value>();
    const liveProps = new Set<string>();
    const attributes: InitialRenderAttribute[] = [];
    const hostAttributes = new Set<string>();
    for (const attribute of childNodes(opening, 'attributes')) {
      const name = identifierLikeName(childNode(attribute, 'name'));
      if (attribute.type !== 'JSXAttribute' || name === null) return need(scope, 'Attribute spread needs browser execution');
      if (bindings && host && !/^on/i.test(name)) {
        const normalized = (name === 'className' ? 'class' : name === 'htmlFor' ? 'for' : name).toLowerCase();
        if (hostAttributes.has(normalized)) need(scope, 'Repeated host attributes need an ordered update proof');
        hostAttributes.add(normalized);
      }
      if (host && /^on/i.test(name)) {
        if (!bindings || !/^on[A-Z]/.test(name)) return need(scope, 'Event handlers require browser execution', 'event');
        bindingEvents=true;
        bindingEventCount++;
        continue;
      }
      if (name === 'ref') return need(scope, 'Refs require browser execution', 'ref');
      if (['route', 'route-to', 'if', 'else-if', 'else', 'innerHTML'].includes(name)) {
        return need(scope, 'Compiler directives need their browser semantics');
      }
      if (name === '__proto__') return need(scope, 'Prototype-bearing props need browser execution');
      const input = childNode(attribute, 'value');
      const valueNode = input?.type === 'JSXExpressionContainer' ? childNode(input, 'expression') : input;
      const value = input === null ? true : expression(valueNode, scope);
      if (host && name !== 'key') attributes.push({ name, value: primitive(value, scope),
        ...(bindings ? {site:initialSite(attribute),live:!staysClosed(valueNode,scope)} : {}) });
      else { props.set(name, value); if (bindings && !staysClosed(valueNode,scope)) liveProps.add(name); }
    }
    if (!host) {
      const component = scope.values.get(tag);
      if (component === null || typeof component !== 'object' || component.kind !== 'component') return need(scope, `Unknown component '${tag}'`);
      if (props.has('children')) return need(scope, 'Explicit children prop needs browser execution');
      if (bindings && (inStructure || !component.local || !('exports' in component.scope))) need(scope,'Structural/local component bindings need a placement proof');
      if (mixed && scope.rootRender && [...props.values()].some(value => value !== null && typeof value === 'object')) {
        need(scope, 'Captured callbacks and object props need an interaction proof');
      }
      const regionCount = regions.length;
      const nodes = children();
      if (bindings && nodes.length) need(scope,'Authored children binding needs an ownership placement proof');
      if (mixed && regions.length !== regionCount) need(scope, 'Interactive content slots need a placement proof');
      if (nodes.length) props.set('children', { kind: 'content', nodes });
      try {
        const eventCount=bindingEventCount;
        const children=render(component, props, false, liveProps);
        if (!bindings) return children;
        if (children.length!==1 || children[0]?.kind!=='element') need(scope,'Initial component bindings need one host root');
        function closed(nodes:readonly InitialRenderNode[]):boolean {
          return nodes.every(node=>node.kind==='text' ? node.live===false :
            node.kind==='element' ? node.attributes.every(attribute=>attribute.live===false)&&closed(node.children) :
            node.kind==='component' ? node.static===true : false);
        }
        return [{kind:'component',site:initialSite(node),moduleId:component.scope.moduleId,callModuleId:scope.moduleId,component:component.local!,children,
          static:eventCount===bindingEventCount && liveProps.size===0 && closed(children)}];
      }
      catch (error) {
        if (!(error instanceof NeedsBrowser) || !mixed || !scope.rootRender) throw error;
        const region = { id: regions.length, site: initialSite(node) };
        if (!region.site) need(scope, 'Initial placement needs authored source identity');
        regions.push(region);
        return [{ kind: 'browser', ...region }];
      }
    }
    const site=bindings ? initialSite(node) : undefined;
    if (bindings && !site) need(scope,'Initial bindings need authored source identity');
    return [{ kind: 'element', tag, ...(site ? {site} : {}), attributes, children: children() }];
  }

  function module(id: string): ModuleScope {
    const existing = modules.get(id);
    if (existing) return existing;
    const scope: ModuleScope = { moduleId: id, values: new Map(), unstable: new Set(), exports: new Map(), unstableExports: new Set() };
    if (visiting.has(id)) need(scope, 'Cyclic module initialization');
    visiting.add(id);
    const program = programs.get(id);
    if (!program) need(scope, 'Unknown module');
    const mountBindings = new Set<string>();
    for (const statement of program.body) {
      if (statement.type === 'ImportDeclaration') {
        if (nodeField(statement, 'importKind') === 'type') continue;
        const specifiers = childNodes(statement, 'specifiers').filter(item => nodeField(item, 'importKind') !== 'type');
        if (childNodes(statement, 'specifiers').length && !specifiers.length) continue;
        const source = stringValue(childNode(statement, 'source'))!;
        if (source === runtimePath && specifiers.length && specifiers.every(item =>
          item.type === 'ImportSpecifier' && identifierLikeName(childNode(item, 'imported')) === 'mount')) {
          for (const item of specifiers) mountBindings.add(identifierLikeName(childNode(item, 'local'))!);
          continue;
        }
        // Only stylesheet side-effect imports can be moved into the HTML product.
        if (!specifiers.length && /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)$/.test(source)) continue;
        const dependencyId = resolveImport(id, source);
        if (dependencyId === undefined) need(scope, `External import '${source}' may have browser effects`);
        const dependency = module(dependencyId);
        for (const item of specifiers) {
          const imported = item.type === 'ImportDefaultSpecifier' ? 'default' : identifierLikeName(childNode(item, 'imported'));
          if (imported === null || !dependency.exports.has(imported)) need(scope, 'Unknown imported binding');
          scope.values.set(identifierLikeName(childNode(item, 'local'))!, dependency.exports.get(imported));
          if (dependency.unstableExports.has(imported)) scope.unstable.add(identifierLikeName(childNode(item, 'local'))!);
        }
        continue;
      }
      if (['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'EmptyStatement'].includes(statement.type) || nodeField(statement, 'exportKind') === 'type') continue;
      const declaration = statement.type.startsWith('Export') ? childNode(statement, 'declaration') : statement;
      if (declaration?.type === 'FunctionDeclaration') {
        const name = childNode(declaration, 'id');
        if (name) bind(name, expression(declaration, scope), scope);
        else if (statement.type !== 'ExportDefaultDeclaration') need(scope, 'Unknown function declaration');
      }
      else if (declaration?.type === 'VariableDeclaration') declarations(declaration, scope);
      else if (statement.type === 'ExportDefaultDeclaration' && declaration !== null) {
        scope.exports.set('default', expression(declaration, scope));
      }
      else if (statement.type === 'ExpressionStatement' && id === root?.mountModuleId) {
        const call = childNode(statement, 'expression');
        const args = call && childNodes(call, 'arguments');
        const name = call && identifierLikeName(childNode(call, 'callee'));
        if (call?.type !== 'CallExpression' || !name || !mountBindings.has(name) || !args || args.length !== 2 ||
            target !== undefined) need(scope, 'Entry statements need browser execution');
        const host = stringValue(args[0]);
        const component = expression(args[1]!, scope);
        if (!host || component === null || typeof component !== 'object' || component.kind !== 'component' ||
            component.scope.moduleId !== root.moduleId) need(scope, 'Unknown mount target or component');
        target = host;
      } else if (statement.type !== 'ExportNamedDeclaration' && statement.type !== 'ExportDefaultDeclaration') {
        need(scope, 'Module initialization needs browser execution');
      } else if (declaration !== null) need(scope, 'Unknown export initializer');
      if (statement.type === 'ExportDefaultDeclaration') {
        scope.exports.set('default', expression(declaration, scope));
      }
      if (statement.type === 'ExportNamedDeclaration') {
        if (childNode(statement, 'source')) need(scope, 'Re-export needs linked initialization proof');
        if (declaration?.type === 'FunctionDeclaration') {
          const name = identifierLikeName(childNode(declaration, 'id'))!;
          scope.exports.set(name, scope.values.get(name));
          if (scope.unstable.has(name)) scope.unstableExports.add(name);
        } else if (declaration?.type === 'VariableDeclaration') {
          for (const item of childNodes(declaration, 'declarations')) {
            const name = identifierLikeName(childNode(item, 'id'));
            if (!name) need(scope, 'Unknown exported binding');
            scope.exports.set(name, scope.values.get(name));
            if (scope.unstable.has(name)) scope.unstableExports.add(name);
          }
        }
        for (const item of childNodes(statement, 'specifiers')) {
          if (nodeField(item, 'exportKind') === 'type') continue;
          const local = identifierLikeName(childNode(item, 'local'))!;
          const exported = identifierLikeName(childNode(item, 'exported')) ?? stringValue(childNode(item, 'exported'))!;
          if (!scope.values.has(local)) need(scope, 'Unknown exported value');
          scope.exports.set(exported, scope.values.get(local));
          if (scope.unstable.has(local)) scope.unstableExports.add(exported);
        }
      }
    }
    visiting.delete(id);
    modules.set(id, scope);
    return scope;
  }

  if (!root) return { kind: 'browser', requirements: [{ moduleId: '', kind: 'unknown', detail: 'No single application root' }] };
  function plan(): InitialRenderPlan {
    module(root!.mountModuleId);
    const component = module(root!.moduleId).values.get(root!.local);
    if (!target || component === null || typeof component !== 'object' || component.kind !== 'component') {
      need({ moduleId: root!.moduleId, values: new Map(), unstable: new Set() }, 'Unknown mounted component');
    }
    const nodes = render(component, new Map(), true);
    const exposure = [...modules.values()].some(scope => [...scope.exports.values()].some(value =>
      value !== null && typeof value === 'object' && (value.kind === 'array' || value.kind === 'object')))
      ? { exposedMutableValues: true as const } : {};
    if (bindings) {
      if (!bindingEvents || !returnSite || nodes.length !== 1 || nodes[0]?.kind !== 'element') need(component.scope,'No direct interactive DOM root');
      const calls = new Map<string,Set<string>>();
      const shapes = new Map<string,string>();
      const rootScope=component.scope;
      function collect(nodes: readonly InitialRenderNode[]): void {
        for(const node of nodes) {
          if (node.kind==='component') {
            const key=`${node.moduleId}#${node.component}`;
            const shape=JSON.stringify(node.children,(key,value)=>['value','live','static'].includes(key)?undefined:value);
            if (shapes.has(key) && shapes.get(key)!==shape) need(rootScope,'Repeated component initial extents need a shared binding shape');
            shapes.set(key,shape);
            const sites=calls.get(key)??new Set<string>(); sites.add(`${node.callModuleId}:${node.site}`);calls.set(key,sites);
          }
          if ('children' in node) collect(node.children);
          if (node.kind==='list') for(const row of node.rows)collect(row);
        }
      }
      collect(nodes);
      for(const [id,scope] of modules) {
        const program=programs.get(id)!;
        const analysis=analyses.get(id)??analyzeScope(program);
        for(const [name,value] of scope.values) {
          if (!value || typeof value!=='object' || value.kind!=='component' || !calls.has(`${value.scope.moduleId}#${value.local}`)) continue;
          const binding=analysis.rootScope.getBinding(name);
          if (binding?.constantViolations.length) need(scope,'Mutable component references need a factory placement proof');
          for(const reference of binding?.references??[]) {
            const parent=analysis.parentByNode.get(reference);
            if (!parent || !['ExportSpecifier','ExportDefaultDeclaration'].includes(parent.type)) need(scope,'Escaped component factories need their ordinary creation program');
          }
        }
        walkAst<BaseNode>(program,{enter(node){
          if (node.type!=='JSXElement') return;
          const tag=identifierLikeName(childNode(childNode(node,'openingElement')!,'name'));
          const value=tag?scope.values.get(tag):undefined;
          if (!value || typeof value!=='object' || value.kind!=='component') return;
          const sites=calls.get(`${value.scope.moduleId}#${value.local}`);
          if (sites && !sites.has(`${id}:${initialSite(node)}`)) need(scope,'Future component placements need their ordinary creation program');
        }});
      }
      return {kind:'bindings',target,mountModuleId:root!.mountModuleId,rootModuleId:root!.moduleId,
        rootLocal:root!.local,returnSite,nodes,...exposure};
    }
    if (regions.some(region => region.site === returnSite) || new Set(regions.map(region => region.site)).size !== regions.length) {
      need(component.scope, 'Initial placements need distinct authored source identities');
    }
    if (mixed && regions.length && returnSite && nodes.some(node => node.kind !== 'browser')) return { kind: 'mixed', target, mountModuleId: root!.mountModuleId,
      rootModuleId: root!.moduleId, rootLocal: root!.local, returnSite, nodes, regions: [...regions] };
    if (mixed && regions.length) need(component.scope, 'No static shell to extract');
    return { kind: 'html', mountModuleId: root!.mountModuleId, target, nodes, ...exposure };
  }
  try { return plan(); } catch (error) {
    if (!(error instanceof NeedsBrowser)) throw error;
    const first = error;
    let dynamicEvaluation = false;
    for (const program of programs.values()) walkAst<BaseNode>(program, { enter(node) {
      if (node.type === 'WithStatement' || node.type === 'ImportExpression' ||
          ['CallExpression', 'NewExpression'].includes(node.type) &&
          ['eval', 'Function'].includes(identifierLikeName(childNode(node, 'callee')) ?? '')) dynamicEvaluation = true;
    } });
    if (dynamicEvaluation) return { kind: 'browser', requirements: [first.requirement] };
    bindings = true;
    modules.clear(); visiting.clear(); rendering.clear(); target = undefined;
    try { return plan(); } catch (error) {
      if (!(error instanceof NeedsBrowser)) throw error;
    }
    bindings=false; mixed=true;
    modules.clear(); visiting.clear(); rendering.clear(); regions.length=0; returnSite=undefined; target=undefined;
    try { return plan(); } catch (error) {
      if (!(error instanceof NeedsBrowser)) throw error;
    }
    return { kind: 'browser', requirements: [first.requirement] };
  }
}
