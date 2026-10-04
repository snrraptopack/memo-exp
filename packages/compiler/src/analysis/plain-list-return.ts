/** Return provenance for closed helpers; effects alone do not describe results. */
import { childNode, childNodes, identifierName, nodeField, stringValue, walkAst, type BaseNode, type Binding, type ScopeAnalysis } from '../ast';
import { astBindingAt, variableDeclaratorFor, type Ctx } from '../context';
import { isPlainScalarValue } from './plain-scalar';
import { LIST_METHOD_OPTIMIZATIONS } from '../lists/mutation-shapes';

export interface PlainListReturn {
  readonly parameters: readonly ('unused' | 'scalar' | 'list')[];
  /** Every indexed read must hit an own dense element, including discarded reads. */
  readonly minimumLengths: readonly number[];
  /** Input fields read by the helper must be own primitive data properties. */
  readonly requiredFields: readonly (readonly string[])[];
  readonly elements: readonly (
    { readonly fields: readonly string[] } |
    // null describes a variable-length set of retained parameter elements.
    { readonly parameter: number; readonly index: number | null }
  )[];
  /** Native behavior must be guarded at the owner's assignment boundary. */
  readonly operations?: readonly string[];
  readonly variableLength?: boolean;
}

type Value = { scalar: true } | { parameter: number } |
  { element: PlainListReturn['elements'][number] } | { list: PlainListReturn['elements']; variableLength?: boolean };

const returnPlans = new WeakMap<Ctx, {
  analysis: ScopeAnalysis;
  dynamicScope: boolean;
  plans: Map<string, PlainListReturn | undefined>;
}>();

/** Only catalogued copy/concat results qualify; authored calls remain intact. */
export function plainListReturn(ctx: Ctx, name: string, visiting = new Set<string>()): PlainListReturn | undefined {
  if (ctx.hot) return;
  const imported = ctx.importedFunctions.get(name)?.plainListReturn;
  if (imported !== undefined) return imported;
  if (ctx.astAnalysis == null || visiting.has(name)) return;
  let cache = returnPlans.get(ctx);
  if (cache?.analysis !== ctx.astAnalysis) {
    let dynamicScope = false;
    walkAst(ctx.astAnalysis.rootScope.block, { enter(node) {
      if (node.type === 'WithStatement' || node.type === 'CallExpression' &&
          identifierName(childNode(node, 'callee')) === 'eval') dynamicScope = true;
    }});
    returnPlans.set(ctx, cache = { analysis: ctx.astAnalysis, dynamicScope, plans: new Map() });
  }
  if (cache.dynamicScope) return;
  if (cache.plans.has(name)) return cache.plans.get(name);
  const plan = analyzePlainListReturn(ctx, name, visiting);
  cache.plans.set(name, plan);
  return plan;
}

function analyzePlainListReturn(ctx: Ctx, name: string, visiting: Set<string>): PlainListReturn | undefined {
  const fn = ctx.helpers.get(name)?.node;
  if (fn === undefined || nodeField(fn, 'async') === true || nodeField(fn, 'generator') === true) return;
  const fnBinding = astBindingAt(ctx, fn, name);
  if (fnBinding === undefined || fnBinding.constantViolations.length !== 0) return;
  const params = childNodes(fn, 'params');
  const requirements: Array<'unused' | 'scalar' | 'list'> = params.map(() => 'unused');
  const minimumLengths = params.map(() => 0);
  const requiredFields = params.map(() => new Set<string>());
  const operations = new Set<string>();
  const values = new Map<Binding, Value>();
  for (let index = 0; index < params.length; index++) {
    const param = params[index]!;
    const name = identifierName(param);
    const binding = name === null ? undefined : astBindingAt(ctx, param, name);
    if (binding === undefined || binding.constantViolations.length !== 0) return;
    values.set(binding, { parameter: index });
  }
  const require = (index: number, kind: 'scalar' | 'list'): boolean => {
    if (requirements[index] !== 'unused' && requirements[index] !== kind) return false;
    requirements[index] = kind; return true;
  };
  const lookup = (node: BaseNode | null): Value | undefined => {
    const name = identifierName(node);
    const binding = node === null || name === null ? undefined : astBindingAt(ctx, node, name);
    return binding === undefined ? undefined : values.get(binding);
  };
  const field = (element: PlainListReturn['elements'][number], name: string): boolean => {
    if ('fields' in element) return element.fields.includes(name);
    if (!require(element.parameter, 'list')) return false;
    requiredFields[element.parameter]!.add(name); return true;
  };
  const scalar = (node: BaseNode | null): boolean => isPlainScalarValue(node, identifier => {
    const value = lookup(identifier);
    return value !== undefined && ('scalar' in value || 'parameter' in value && require(value.parameter, 'scalar'));
  }, member => {
    if (nodeField(member, 'optional') === true) return false;
    const key = childNode(member, 'property');
    const name = nodeField(member, 'computed') === true ? stringValue(key) : identifierName(key);
    if (name === null) return false;
    const receiver = evaluate(childNode(member, 'object'));
    if (name === 'length' && receiver !== undefined && ('parameter' in receiver || 'list' in receiver)) {
      return !('parameter' in receiver) || require(receiver.parameter, 'list');
    }
    return receiver !== undefined && 'element' in receiver && field(receiver.element, name);
  });
  const asList = (value: Value | undefined): PlainListReturn['elements'] | undefined => {
    if (value !== undefined && 'list' in value) return value.list;
    if (value !== undefined && 'parameter' in value && require(value.parameter, 'list')) {
      return [{ parameter: value.parameter, index: null }];
    }
  };
  const nextVisiting = new Set(visiting).add(name);
  const evaluate = (node: BaseNode | null): Value | undefined => {
    if (node === null) return;
    if (node.type === 'Identifier') return lookup(node);
    if (scalar(node)) return { scalar: true };
    if (node.type === 'ObjectExpression') {
      const fields: string[] = [];
      for (const entry of childNodes(node, 'properties')) {
        const key = childNode(entry, 'key');
        const name = identifierName(key) ?? (key?.type === 'Literal' && typeof nodeField(key, 'value') === 'string' ? nodeField(key, 'value') as string : null);
        if (entry.type !== 'Property' || nodeField(entry, 'kind') !== 'init' || nodeField(entry, 'computed') === true ||
            name === null || name === '__proto__' || fields.includes(name) || !scalar(childNode(entry, 'value'))) return;
        fields.push(name);
      }
      return { element: { fields } };
    }
    if (node.type === 'MemberExpression' && nodeField(node, 'computed') === true && nodeField(node, 'optional') !== true) {
      const receiver = lookup(childNode(node, 'object'));
      const property = childNode(node, 'property');
      const index = property?.type === 'Literal' ? nodeField(property, 'value') : null;
      if (receiver !== undefined && 'parameter' in receiver && typeof index === 'number' &&
          Number.isSafeInteger(index) && index >= 0 && require(receiver.parameter, 'list')) {
        minimumLengths[receiver.parameter] = Math.max(minimumLengths[receiver.parameter]!, index + 1);
        return { element: { parameter: receiver.parameter, index } };
      }
      return;
    }
    if (node.type === 'ArrayExpression') {
      const elements = nodeField(node, 'elements');
      if (!Array.isArray(elements)) return;
      const result: PlainListReturn['elements'][number][] = [];
      for (const element of elements) {
        const value = evaluate(element);
        if (value === undefined || !('element' in value)) return;
        result.push(value.element);
      }
      return { list: result };
    }
    if (node.type === 'CallExpression' && nodeField(node, 'optional') !== true) {
      const callee = childNode(node, 'callee');
      if (callee?.type === 'MemberExpression' && nodeField(callee, 'optional') !== true) {
        const property = childNode(callee, 'property');
        const method = nodeField(callee, 'computed') === true ? stringValue(property) : identifierName(property);
        const candidate = method === null || !Object.hasOwn(LIST_METHOD_OPTIMIZATIONS, method)
          ? undefined : LIST_METHOD_OPTIMIZATIONS[method];
        if (candidate?.result !== 'copy' && candidate?.result !== 'concat') return;
        const receiver = asList(evaluate(childNode(callee, 'object')));
        const args = childNodes(node, 'arguments');
        if (receiver === undefined || args.some(arg => arg.type === 'SpreadElement')) return;
        const result = [...receiver];
        if (candidate.result === 'copy') {
          if (args.length > candidate.maxArguments! || !args.every(scalar)) return;
        } else for (const arg of args) {
          const list = asList(evaluate(arg));
          if (list === undefined) return;
          result.push(...list);
        }
        operations.add(method!);
        // Copies may truncate/reorder any position. Keep schema information,
        // but projections must no longer promise a fixed extent or input index.
        return { list: result.map(element => 'fields' in element ? element : { parameter: element.parameter, index: null }), variableLength: true };
      }
      const calleeName = identifierName(callee);
      const binding = callee === null || calleeName === null ? undefined : astBindingAt(ctx, callee, calleeName);
      const declaration = binding === undefined ? null : variableDeclaratorFor(ctx, binding);
      if (binding === undefined || binding.constantViolations.length !== 0 ||
          !(binding.kind === 'import' || ctx.helpers.get(calleeName!)?.node === binding.declarationNode ||
            declaration !== null && childNode(declaration, 'init') === ctx.helpers.get(calleeName!)?.node)) return;
      const plan = plainListReturn(ctx, calleeName!, nextVisiting);
      const args = childNodes(node, 'arguments');
      if (plan === undefined || args.length !== plan.parameters.length || args.some(arg => arg.type === 'SpreadElement')) return;
      const arguments_: Value[] = [];
      for (let index = 0; index < args.length; index++) {
        const kind = plan.parameters[index]!;
        // Even unused arguments execute; require a closed primitive expression.
        if (kind !== 'list') {
          if (!scalar(args[index]!)) return;
          arguments_.push({ scalar: true });
        } else {
          const value = evaluate(args[index]!);
          if (value === undefined || !('parameter' in value || 'list' in value)) return;
          if ('parameter' in value && !require(value.parameter, 'list')) return;
          if ('parameter' in value) {
            minimumLengths[value.parameter] = Math.max(minimumLengths[value.parameter]!, plan.minimumLengths[index]!);
          } else if (value.list.length < plan.minimumLengths[index]!) return;
          if ('list' in value && (value.variableLength || value.list.some(element => !('fields' in element) && element.index === null)) &&
              plan.minimumLengths[index]! > 0) return;
          for (const name of plan.requiredFields[index]!) {
            if ('parameter' in value) requiredFields[value.parameter]!.add(name);
            else if (!value.list.every(element => field(element, name))) return;
          }
          arguments_.push(value);
        }
      }
      const result: PlainListReturn['elements'][number][] = [];
      let variableLength = plan.variableLength === true;
      for (const element of plan.elements) {
        if ('fields' in element) result.push(element);
        else {
          const argument = arguments_[element.parameter]!;
          if ('parameter' in argument) result.push({ parameter: argument.parameter, index: element.index });
          else if ('list' in argument && element.index === null) {
            result.push(...argument.list);
            variableLength ||= argument.variableLength === true;
          }
          else if ('list' in argument && element.index !== null && argument.list[element.index] !== undefined) result.push(argument.list[element.index]!);
          else return;
        }
      }
      for (const operation of plan.operations ?? []) operations.add(operation);
      return { list: result, ...(variableLength ? { variableLength: true } : {}) };
    }
  };
  const body = childNode(fn, 'body');
  const statements = body?.type === 'BlockStatement' ? childNodes(body, 'body') : [];
  let result: Value | undefined;
  if (body?.type !== 'BlockStatement') result = evaluate(body);
  else {
    for (const statement of statements.slice(0, -1)) {
      if (statement.type !== 'VariableDeclaration' || nodeField(statement, 'kind') !== 'const') return;
      for (const declaration of childNodes(statement, 'declarations')) {
        const id = childNode(declaration, 'id');
        const name = identifierName(id);
        const binding = id === null || name === null ? undefined : astBindingAt(ctx, id, name);
        const value = evaluate(childNode(declaration, 'init'));
        if (binding === undefined || binding.constantViolations.length !== 0 || value === undefined) return;
        values.set(binding, value);
      }
    }
    const last = statements.at(-1);
    if (last?.type !== 'ReturnStatement') return;
    result = evaluate(childNode(last, 'argument'));
  }
  const elements = asList(result);
  return elements !== undefined ? {
    parameters: requirements, minimumLengths,
    requiredFields: requiredFields.map(fields => [...fields].sort()), elements,
    ...(operations.size === 0 ? {} : { operations: [...operations].sort() }),
    ...(result !== undefined && 'list' in result && result.variableLength ? { variableLength: true } : {}),
  } : undefined;
}
