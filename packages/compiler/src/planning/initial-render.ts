/**
 * Initial content and browser execution are separate compiler products.
 * This first proof covers closed, deterministic component composition. Unknown
 * code stays in the browser; planning never executes an authored function.
 */
import {
  childNode, childNodes, identifierLikeName, isFunctionNode, nodeField,
  stringValue, type BaseNode, type Program,
} from '../ast';
import { normalizeJsxText } from '../components/children';
import { nodeHasJsx } from '../context';
import { analyzeComponentPropShape } from '../components/prop-shape';

export type InitialRenderNode =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'element'; readonly tag: string;
      readonly attributes: readonly InitialRenderAttribute[];
      readonly children: readonly InitialRenderNode[] };

export interface InitialRenderAttribute {
  readonly name: string;
  readonly value: string | number | boolean | null | undefined;
}

export interface BrowserRequirement {
  readonly moduleId: string;
  readonly kind: 'event' | 'ref' | 'lifecycle' | 'unknown';
  readonly detail: string;
}

export type InitialRenderPlan =
  | { readonly kind: 'html'; readonly target: string;
      readonly mountModuleId: string; readonly nodes: readonly InitialRenderNode[] }
  | { readonly kind: 'browser'; readonly requirements: readonly BrowserRequirement[] };

type Value = string | number | boolean | null | undefined | ValueObject | Component | Content;
interface ValueObject { readonly kind: 'object'; readonly fields: ReadonlyMap<string, Value> }
interface Component { readonly kind: 'component'; readonly node: BaseNode; readonly scope: Scope }
interface Content { readonly kind: 'content'; readonly nodes: readonly InitialRenderNode[] }
interface Scope { readonly moduleId: string; readonly values: Map<string, Value> }
interface ModuleScope extends Scope { readonly exports: Map<string, Value> }

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
  let target: string | undefined;

  function primitive(value: Value, scope: Scope): string | number | boolean | null | undefined {
    if (value !== null && typeof value === 'object') need(scope, 'Object coercion needs browser execution');
    return value;
  }

  function expression(node: BaseNode | null, scope: Scope): Value {
    if (node === null) return undefined;
    if (isFunctionNode(node)) return { kind: 'component', node, scope };
    switch (node.type) {
      case 'Literal': case 'StringLiteral': case 'NumericLiteral': case 'BooleanLiteral': case 'NullLiteral': {
        const value = node.type === 'NullLiteral' ? null : nodeField(node, 'value');
        if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value as Value;
        return need(scope, 'Unsupported literal');
      }
      case 'Identifier': {
        const name = identifierLikeName(node)!;
        if (!scope.values.has(name)) return need(scope, `Unknown value '${name}'`);
        return scope.values.get(name);
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
      case 'MemberExpression': {
        const object = expression(childNode(node, 'object'), scope);
        const name = nodeField(node, 'computed')
          ? primitive(expression(childNode(node, 'property'), scope), scope)
          : identifierLikeName(childNode(node, 'property'));
        if (object === null || typeof object !== 'object' || object.kind !== 'object' || typeof name !== 'string') {
          return need(scope, 'Member reads outside closed props need browser execution');
        }
        if (!object.fields.has(name) && name in Object.prototype) return need(scope, 'Inherited property read needs browser execution');
        return object.fields.get(name);
      }
      case 'ConditionalExpression':
        return expression(childNode(node, primitive(expression(childNode(node, 'test'), scope), scope)
          ? 'consequent' : 'alternate'), scope);
      case 'LogicalExpression': {
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
      scope.values.set(identifierLikeName(pattern)!, value);
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
      }
      return;
    }
    need(scope, 'Unknown binding pattern');
  }

  function declarations(node: BaseNode, scope: Scope): void {
    for (const declaration of childNodes(node, 'declarations')) {
      bind(childNode(declaration, 'id'), expression(childNode(declaration, 'init'), scope), scope);
    }
  }

  function content(value: Value, scope: Scope): readonly InitialRenderNode[] {
    if (value !== null && typeof value === 'object') {
      if (value.kind === 'content') return value.nodes;
      return need(scope, 'Non-content object child');
    }
    return value == null || typeof value === 'boolean' ? [] : [{ kind: 'text', value: String(value) }];
  }

  function render(component: Component, props: ReadonlyMap<string, Value>, rootCall = false): readonly InitialRenderNode[] {
    if (rendering.has(component)) need(component.scope, 'Recursive component composition');
    if (nodeField(component.node, 'async') || nodeField(component.node, 'generator')) need(component.scope, 'Async component');
    rendering.add(component);
    const scope: Scope = { moduleId: component.scope.moduleId, values: new Map(component.scope.values) };
    const params = childNodes(component.node, 'params');
    const shape = analyzeComponentPropShape(params);
    if (shape.mode === 'object' && params[0]) {
      bind(params[0], rootCall || !props.size && shape.hasWholeDefault
        ? undefined : { kind: 'object', fields: props }, scope);
    } else {
      for (let index = 0; index < params.length; index++) {
        bind(params[index]!, rootCall ? undefined : props.get(shape.names[index]!), scope);
      }
    }
    const body = childNode(component.node, 'body');
    let result: readonly InitialRenderNode[] | undefined;
    if (body?.type !== 'BlockStatement') result = content(expression(body, scope), scope);
    else {
      for (const statement of childNodes(body, 'body')) {
        if (statement.type === 'VariableDeclaration') declarations(statement, scope);
        else if (statement.type === 'FunctionDeclaration') bind(childNode(statement, 'id'), expression(statement, scope), scope);
        else if (statement.type === 'ReturnStatement') { result = content(expression(childNode(statement, 'argument'), scope), scope); break; }
        else if (statement.type !== 'EmptyStatement') {
          if (statement.type === 'ExpressionStatement') expression(childNode(statement, 'expression'), scope);
          need(scope, 'Component setup needs browser execution');
        }
      }
    }
    rendering.delete(component);
    return result ?? need(scope, 'Component has no closed return');
  }

  function jsx(node: BaseNode, scope: Scope): readonly InitialRenderNode[] {
    function children(): InitialRenderNode[] {
      const result: InitialRenderNode[] = [];
      const pending: Array<string | number | boolean | null | undefined> = [];
      function flush(): void {
        if (!pending.length) return;
        // The existing DOM backend joins adjacent authored expressions.
        // Nullable/boolean/numeric joins require a shared text operation plan;
        // don't change their coercion by folding each child independently.
        if (pending.length > 1 && pending.some(value => typeof value !== 'string')) {
          need(scope, 'Mixed adjacent text expressions need a shared text plan');
        }
        result.push(...content(pending.length === 1 ? pending[0] : pending.join(''), scope));
        pending.length = 0;
      }
      for (const child of childNodes(node, 'children')) {
        if (child.type === 'JSXText') {
          const text = normalizeJsxText(String(nodeField(child, 'value')));
          if (text) pending.push(text);
          continue;
        }
        if (child.type === 'JSXExpressionContainer') {
          const input = childNode(child, 'expression');
          if (input?.type === 'JSXEmptyExpression') continue;
          if (input && (nodeField(input, 'value') === null || typeof nodeField(input, 'value') === 'boolean')) continue;
          const value = expression(input, scope);
          if (value !== null && typeof value === 'object' || input && nodeHasJsx(input)) {
            flush();
            result.push(...content(value, scope));
          } else pending.push(primitive(value, scope));
          continue;
        }
        flush();
        result.push(...jsx(child, scope));
      }
      flush();
      return result;
    }
    if (node.type === 'JSXFragment') return children();
    if (node.type !== 'JSXElement') return need(scope, 'Unknown JSX child');
    const opening = childNode(node, 'openingElement')!;
    const tag = identifierLikeName(childNode(opening, 'name'));
    if (tag === null) return need(scope, 'Dynamic tag needs browser execution');
    const host = /^[a-z]/.test(tag);
    const props = new Map<string, Value>();
    const attributes: InitialRenderAttribute[] = [];
    for (const attribute of childNodes(opening, 'attributes')) {
      const name = identifierLikeName(childNode(attribute, 'name'));
      if (attribute.type !== 'JSXAttribute' || name === null) return need(scope, 'Attribute spread needs browser execution');
      if (host && /^on/i.test(name)) return need(scope, 'Event handlers require browser execution', 'event');
      if (host && name === 'ref') return need(scope, 'Refs require browser execution', 'ref');
      if (name === '__proto__') return need(scope, 'Prototype-bearing props need browser execution');
      const input = childNode(attribute, 'value');
      const value = input === null ? true : expression(input.type === 'JSXExpressionContainer'
        ? childNode(input, 'expression') : input, scope);
      if (host && name !== 'key') attributes.push({ name, value: primitive(value, scope) });
      else props.set(name, value);
    }
    if (!host) {
      const component = scope.values.get(tag);
      if (component === null || typeof component !== 'object' || component.kind !== 'component') return need(scope, `Unknown component '${tag}'`);
      if (props.has('children')) return need(scope, 'Explicit children prop needs browser execution');
      const nodes = children();
      if (nodes.length) props.set('children', { kind: 'content', nodes });
      return render(component, props);
    }
    return [{ kind: 'element', tag, attributes, children: children() }];
  }

  function module(id: string): ModuleScope {
    const existing = modules.get(id);
    if (existing) return existing;
    const scope: ModuleScope = { moduleId: id, values: new Map(), exports: new Map() };
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
        } else if (declaration?.type === 'VariableDeclaration') {
          for (const item of childNodes(declaration, 'declarations')) {
            const name = identifierLikeName(childNode(item, 'id'));
            if (!name) need(scope, 'Unknown exported binding');
            scope.exports.set(name, scope.values.get(name));
          }
        }
        for (const item of childNodes(statement, 'specifiers')) {
          if (nodeField(item, 'exportKind') === 'type') continue;
          const local = identifierLikeName(childNode(item, 'local'))!;
          const exported = identifierLikeName(childNode(item, 'exported')) ?? stringValue(childNode(item, 'exported'))!;
          if (!scope.values.has(local)) need(scope, 'Unknown exported value');
          scope.exports.set(exported, scope.values.get(local));
        }
      }
    }
    visiting.delete(id);
    modules.set(id, scope);
    return scope;
  }

  if (!root) return { kind: 'browser', requirements: [{ moduleId: '', kind: 'unknown', detail: 'No single application root' }] };
  try {
    module(root.mountModuleId);
    const component = module(root.moduleId).values.get(root.local);
    if (!target || component === null || typeof component !== 'object' || component.kind !== 'component') {
      need({ moduleId: root.moduleId, values: new Map() }, 'Unknown mounted component');
    }
    return { kind: 'html', mountModuleId: root.mountModuleId, target, nodes: render(component, new Map(), true) };
  } catch (error) {
    if (!(error instanceof NeedsBrowser)) throw error;
    return { kind: 'browser', requirements: [error.requirement] };
  }
}
