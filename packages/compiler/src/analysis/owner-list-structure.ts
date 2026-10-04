/** Closed owner arrays with proven retained-content-preserving writes. */
import type * as t from '../ast/compiler-types';
import {
  childNode, childNodes, identifierName, nodeField, stringValue, walkAst, ESTREE_VISITOR_KEYS,
  type BaseNode, type Binding,
} from '../ast';
import { astBindingAt, variableDeclaratorFor, type Ctx, type MapCallExpression } from '../context';
import { matchMapCall } from '../lists/source-shapes';
import { isPlainScalarValue } from './plain-scalar';
import { plainListReturn } from './plain-list-return';
import { publishedOwnerDependency } from './published-owner-dependency';
import { generatedIdentifier } from '../identifiers';
import { LIST_METHOD_OPTIMIZATIONS } from '../lists/mutation-shapes';

export interface OwnerListOperation {
  readonly owner: string;
  readonly token: string;
  readonly operations: string[];
  readonly guards: string[];
  readonly fresh: boolean;
}
export interface CapturedOwnerListWrites {
  readonly structuralWrites: WeakMap<t.Node, string>;
  readonly operations: readonly { assignment: t.AssignmentExpression; plan: OwnerListOperation }[];
}

function property(node: BaseNode): string | null {
  const key = childNode(node, 'property');
  return nodeField(node, 'computed') === true ? stringValue(key) : identifierName(key);
}

/** Dense literals only: spreads may invoke an overridden iterator. */
function elements(node: BaseNode | null): BaseNode[] | null {
  if (node?.type !== 'ArrayExpression') return null;
  const values = nodeField(node, 'elements');
  return Array.isArray(values) && values.every(value => value !== null && value.type !== 'SpreadElement')
    ? values as BaseNode[] : null;
}

function recordFields(node: BaseNode): Set<string> | null {
  if (node.type !== 'ObjectExpression') return null;
  const fields = new Set<string>();
  for (const entry of childNodes(node, 'properties')) {
    const name = identifierName(childNode(entry, 'key')) ?? stringValue(childNode(entry, 'key'));
    if (entry.type !== 'Property' || nodeField(entry, 'kind') !== 'init' ||
        nodeField(entry, 'computed') === true || name === null || name === '__proto__' ||
        fields.has(name) || !isPlainScalarValue(childNode(entry, 'value'), () => false)) return null;
    fields.add(name);
  }
  return fields;
}

export function analyzeOwnerListStructure(ctx: Ctx): void {
  const analysis = ctx.astAnalysis;
  if (analysis == null || ctx.hot) return;
  let dynamicScope = false;
  walkAst(analysis.rootScope.block, { enter(node) {
    if (node.type === 'WithStatement' || node.type === 'CallExpression' &&
        identifierName(childNode(node, 'callee')) === 'eval') dynamicScope = true;
  }});
  if (dynamicScope) return;
  const parents = analysis.parentByNode;
  const sameBinding = (node: BaseNode | null, binding: Binding): boolean => {
    const name = identifierName(node);
    return node !== null && name !== null && astBindingAt(ctx, node, name) === binding;
  };
  const readOnly = (node: BaseNode): boolean => {
    let current = node;
    for (let parent = parents.get(current); parent != null; parent = parents.get(current)) {
      if (parent.type === 'AssignmentExpression' || parent.type === 'ForOfStatement' || parent.type === 'ForInStatement') {
        return childNode(parent, 'left') !== current;
      }
      if (parent.type === 'UpdateExpression' || parent.type === 'UnaryExpression' && nodeField(parent, 'operator') === 'delete') return false;
      if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(parent.type)) break;
      current = parent;
    }
    return true;
  };
  for (const [owner, path] of ctx.compPaths) {
    // In-place changes must publish ordinary causes even if host creation
    // invokes them during reconciliation. Unknown callbacks cannot promise it.
    const publishedContentCallbacks = new Set<BaseNode>();
    walkAst<BaseNode>(path.node, { enter(node) {
      if (node !== path.node && ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(node.type)) return false;
      if (node.type !== 'JSXOpeningElement') return;
      const tag = childNode(node, 'name');
      const name = tag && nodeField(tag, 'name');
      if (tag?.type !== 'JSXIdentifier' || typeof name !== 'string' || !/^[a-z]/.test(name)) return;
      for (const attribute of childNodes(node, 'attributes')) {
        const event = childNode(attribute, 'name');
        const eventName = event && nodeField(event, 'name');
        const value = childNode(attribute, 'value');
        const callback = value?.type === 'JSXExpressionContainer' ? childNode(value, 'expression') : null;
        if (attribute.type === 'JSXAttribute' && typeof eventName === 'string' && /^on[A-Z]/.test(eventName) &&
            callback !== null && ['ArrowFunctionExpression', 'FunctionExpression'].includes(callback.type)) {
          publishedContentCallbacks.add(callback);
        }
      }
    }});
    const publishesContent = (node: BaseNode): boolean => {
      for (let parent = parents.get(node); parent != null; parent = parents.get(parent)) {
        if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(parent.type)) {
          return publishedContentCallbacks.has(parent);
        }
      }
      return false;
    };
    const candidates = new Map<Binding, string>();
    walkAst(path.node, { enter(node) {
      const call = matchMapCall(node as t.Node);
      if (call === null || ctx.analyzedListSources.get(call)?.local !== true) return;
      const source = childNode(childNode(call, 'callee')!, 'object');
      const name = identifierName(source);
      const binding = source === null || name === null ? undefined : astBindingAt(ctx, source, name);
      if (binding !== undefined && ctx.instanceState.get(owner)?.has(name!) &&
          astBindingAt(ctx, path.node.body, name!) === binding) candidates.set(binding, name!);
    }});
    for (const [binding, source] of candidates) {
      const safeArguments = new Set<BaseNode>();
      let requiredLength = 0;
      const requiredFields = new Set<string>();
      const retainedElements = new Set<BaseNode>();
      const operations = new Map<BaseNode, string[]>();
      const freshWrites = new Map<BaseNode, boolean>();
      let currentOperations = new Set<string>();
      let currentUsesSource = false;
      const retained = (reference: BaseNode): BaseNode[] => {
        currentUsesSource = true;
        safeArguments.add(reference);
        const marker = { type: 'OwnerListElements' } as BaseNode;
        retainedElements.add(marker); return [marker];
      };
      const scalar = (node: BaseNode | null, visiting = new Set<Binding>()): boolean => isPlainScalarValue(node, identifier => {
        const name = identifierName(identifier)!;
        const scalarBinding = astBindingAt(ctx, identifier, name);
        if (scalarBinding === undefined || scalarBinding.kind !== 'const' || scalarBinding.constantViolations.length !== 0 ||
            visiting.has(scalarBinding)) return false;
        const declaration = variableDeclaratorFor(ctx, scalarBinding);
        return declaration !== null && scalar(childNode(declaration, 'init'), new Set(visiting).add(scalarBinding));
      }, member => {
        const object = childNode(member, 'object');
        if (object === null || !sameBinding(object, binding) || property(member) !== 'length' ||
            nodeField(member, 'optional') === true || !readOnly(member)) return false;
        currentUsesSource = true; return true;
      });
      const returnedElements = (node: BaseNode | null): BaseNode[] | null => {
        if (node !== null && sameBinding(node, binding)) return retained(node);
        const literal = elements(node);
        if (literal !== null) return [...literal];
        if (node?.type === 'ArrayExpression') {
          const result: BaseNode[] = [];
          for (const entry of childNodes(node, 'elements')) {
            if (entry.type !== 'SpreadElement') result.push(entry);
            else {
              const values = returnedElements(childNode(entry, 'argument'));
              if (values === null) return null;
              currentOperations.add('iterator'); result.push(...values);
            }
          }
          // Preserve hole rejection even though childNodes excludes holes.
          const entries = nodeField(node, 'elements');
          if (!Array.isArray(entries) || entries.some(entry => entry === null)) return null;
          return result;
        }
        if (node?.type !== 'CallExpression' || nodeField(node, 'optional') === true) return null;
        const callee = childNode(node, 'callee');
        if (callee?.type === 'MemberExpression' && nodeField(callee, 'optional') !== true) {
          const method = property(callee);
          const candidate = method === null || !Object.hasOwn(LIST_METHOD_OPTIMIZATIONS, method)
            ? undefined : LIST_METHOD_OPTIMIZATIONS[method];
          if (candidate?.result === undefined) return null;
          const receiver = returnedElements(childNode(callee, 'object'));
          const args = childNodes(node, 'arguments');
          if (receiver === null || args.some(arg => arg.type === 'SpreadElement')) return null;
          currentOperations.add(method!);
          if (candidate.result === 'copy') {
            if (args.length > candidate.maxArguments! || !args.every(arg => scalar(arg))) return null;
          } else if (candidate.result === 'concat') {
            for (const arg of args) {
              const values = returnedElements(arg);
              if (values === null) return null;
              receiver.push(...values);
            }
          } else {
            if (args.length !== 1) return null;
            const callback = args[0]!;
            const params = childNodes(callback, 'params');
            const body = childNode(callback, 'body');
            if (callback.type !== 'ArrowFunctionExpression' || nodeField(callback, 'async') === true ||
                params.length > 2 || params.some(param => param.type !== 'Identifier')) return null;
            const item = params[0] && astBindingAt(ctx, params[0], identifierName(params[0])!);
            const index = params[1] && astBindingAt(ctx, params[1], identifierName(params[1])!);
            if (item?.constantViolations.length || index?.constantViolations.length) return null;
            const callbackScalar = (expression: BaseNode | null): boolean => isPlainScalarValue(expression, identifier =>
              index !== undefined && sameBinding(identifier, index) || scalar(identifier), member => {
              const name = property(member);
              if (item === undefined || name === null || nodeField(member, 'optional') === true ||
                  !sameBinding(childNode(member, 'object'), item)) return false;
              requiredFields.add(name); return true;
            });
            if (candidate.result === 'filter') {
              if (!callbackScalar(body)) return null;
            } else {
              const mapValues = (expression: BaseNode | null): BaseNode[] | null => {
                if (item !== undefined && sameBinding(expression, item)) return [];
                if (expression?.type === 'ConditionalExpression') {
                  if (!callbackScalar(childNode(expression, 'test'))) return null;
                  const consequent = mapValues(childNode(expression, 'consequent'));
                  const alternate = mapValues(childNode(expression, 'alternate'));
                  return consequent === null || alternate === null ? null : [...consequent, ...alternate];
                }
                if (expression?.type !== 'ObjectExpression') return null;
                const fields = new Set<string>();
                for (const entry of childNodes(expression, 'properties')) {
                  const name = identifierName(childNode(entry, 'key')) ?? stringValue(childNode(entry, 'key'));
                  if (entry.type !== 'Property' || nodeField(entry, 'kind') !== 'init' ||
                      nodeField(entry, 'computed') === true || name === null || name === '__proto__' ||
                      fields.has(name) || !callbackScalar(childNode(entry, 'value'))) return null;
                  fields.add(name);
                }
                return [{ type: 'ObjectExpression', properties: [...fields].map(name => ({
                  type: 'Property', kind: 'init', computed: false,
                  key: { type: 'Identifier', name }, value: { type: 'Literal', value: 0 },
                })) } as BaseNode];
              };
              const values = mapValues(body);
              if (values === null) return null;
              receiver.push(...values);
            }
          }
          // These methods may shorten a list to zero. Keep producer field
          // facts, but do not infer a minimum extent from synthetic markers.
          const marker = { type: 'OwnerListElements' } as BaseNode;
          retainedElements.add(marker); receiver.push(marker); return receiver;
        }
        const name = identifierName(callee);
        const helperBinding = callee === null || name === null ? undefined : astBindingAt(ctx, callee, name);
        const helperDeclaration = helperBinding === undefined ? null : variableDeclaratorFor(ctx, helperBinding);
        if (helperBinding === undefined || helperBinding.constantViolations.length !== 0 ||
            !(helperBinding.kind === 'import' || ctx.helpers.get(name!)?.node === helperBinding.declarationNode ||
              helperDeclaration !== null && childNode(helperDeclaration, 'init') === ctx.helpers.get(name!)?.node)) return null;
        const plan = plainListReturn(ctx, name!);
        const args = childNodes(node, 'arguments');
        if (plan === undefined || args.length !== plan.parameters.length || args.some(arg => arg.type === 'SpreadElement')) return null;
        for (const operation of plan.operations ?? []) currentOperations.add(operation);
        for (let index = 0; index < args.length; index++) {
          if (plan.parameters[index] === 'list') {
            if (!sameBinding(args[index]!, binding)) return null;
            currentUsesSource = true;
            safeArguments.add(args[index]!);
            requiredLength = Math.max(requiredLength, plan.minimumLengths[index]!);
            for (const field of plan.requiredFields[index]!) requiredFields.add(field);
          } else if (!scalar(args[index]!)) return null;
        }
        // These synthetic nodes describe proven values only. Authored calls are
        // preserved; scope checks use the original argument binding identities.
        const result = plan.elements.flatMap(element => 'fields' in element ? [{
          type: 'ObjectExpression', properties: element.fields.map(name => ({
            type: 'Property', kind: 'init', computed: false,
            key: { type: 'Identifier', name }, value: { type: 'Literal', value: 0 },
          })),
        } as BaseNode] : element.index === null ? retained(args[element.parameter]!) : [{
          type: 'MemberExpression', computed: true, optional: false,
          object: args[element.parameter], property: { type: 'Literal', value: element.index },
        } as BaseNode]);
        if (plan.variableLength) {
          const marker = { type: 'OwnerListElements' } as BaseNode;
          retainedElements.add(marker); result.push(marker);
        }
        return result;
      };
      const declaration = variableDeclaratorFor(ctx, binding);
      const initial = returnedElements(declaration && childNode(declaration, 'init'));
      if (initial === null || currentOperations.size !== 0 || initial.some(value => recordFields(value) === null)) continue;
      const arrays: BaseNode[][] = [initial];
      let valid = true;
      for (const violation of binding.constantViolations) {
        currentOperations = new Set();
        currentUsesSource = false;
        const values = returnedElements(childNode(violation, 'right'));
        if (violation.type !== 'AssignmentExpression' || nodeField(violation, 'operator') !== '=' ||
            !sameBinding(childNode(violation, 'left'), binding) || values === null) { valid = false; break; }
        arrays.push(values);
        operations.set(violation, [...currentOperations].sort());
        walkAst(childNode(violation, 'right')!, { enter(node) {
          if (sameBinding(node, binding)) currentUsesSource = true;
        }});
        freshWrites.set(violation, !currentUsesSource);
      }
      if (!valid) continue;
      let minimumLength = Math.min(...arrays.map(array => array.some(value => retainedElements.has(value)) ? 0 : array.length));
      for (const reference of binding.references) {
        const use = parents.get(reference);
        const consumer = use && parents.get(use);
        if (use?.type === 'MemberExpression' && property(use) === 'length' &&
            consumer?.type === 'AssignmentExpression' && childNode(consumer, 'left') === use) {
          const right = childNode(consumer, 'right');
          const value = right && nodeField(right, 'value');
          if (nodeField(consumer, 'operator') !== '=' || right?.type !== 'Literal' ||
              typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) { valid = false; break; }
          minimumLength = Math.min(minimumLength, value);
        }
      }
      if (!valid || requiredLength > minimumLength) continue;
      const indexedItem = (node: BaseNode | null): boolean => {
        if (node === null) return false;
        const index = childNode(node, 'property');
        const value = index && nodeField(index, 'value');
        return node.type === 'MemberExpression' && nodeField(node, 'computed') === true &&
          nodeField(node, 'optional') !== true && sameBinding(childNode(node, 'object'), binding) &&
          index?.type === 'Literal' && typeof value === 'number' && Number.isSafeInteger(value) &&
          value >= 0 && value < minimumLength;
      };
      let fields: Set<string> | null = null;
      const record = (node: BaseNode): boolean => {
        const own = recordFields(node);
        if (own === null) return false;
        if (fields === null) fields = own;
        else for (const name of fields) if (!own.has(name)) fields.delete(name);
        return true;
      };
      for (const array of arrays) for (const value of array) {
        if (!retainedElements.has(value) && !indexedItem(value) && !record(value)) valid = false;
      }
      // Include every indexed replacement before inspecting any row reads.
      for (const reference of binding.references) {
        const use = parents.get(reference);
        const consumer = use && parents.get(use);
        if (use != null && indexedItem(use) && consumer?.type === 'AssignmentExpression' &&
            childNode(consumer, 'left') === use) {
          const right = childNode(consumer, 'right');
          if (nodeField(consumer, 'operator') !== '=' || right === null ||
              !indexedItem(right) && !record(right)) valid = false;
        }
      }
      const knownFields = fields as ReadonlySet<string> | null;
      if (!valid || knownFields === null || knownFields.size === 0) continue;
      if ([...requiredFields].some(field => !knownFields.has(field))) continue;
      const publishedDependency = publishedOwnerDependency(ctx, owner, path.node);
      const scalarField = (node: BaseNode): boolean => node.type === 'MemberExpression' &&
        indexedItem(childNode(node, 'object')) && knownFields.has(property(node) ?? '');
      const contentWrite = (node: BaseNode): boolean => {
        const assignment = parents.get(node);
        return scalarField(node) && assignment?.type === 'AssignmentExpression' &&
          childNode(assignment, 'left') === node && nodeField(assignment, 'operator') === '=' &&
          publishesContent(assignment) &&
          isPlainScalarValue(childNode(assignment, 'right'), () => false, scalarField);
      };
      let mutableContents = false;
      const structuralWrites = new Set<BaseNode>(binding.constantViolations);
      const arrayElements = new Set(arrays.flat());
      const calls: MapCallExpression[] = [];
      const pureRow = (call: BaseNode): boolean => {
        if (nodeField(call, 'optional') === true || childNodes(call, 'arguments').length !== 1) return false;
        const callback = childNodes(call, 'arguments')[0]!;
        const params = childNodes(callback, 'params');
        const body = childNode(callback, 'body');
        if (callback.type !== 'ArrowFunctionExpression' || nodeField(callback, 'async') === true ||
            params.length < 1 || params.length > 2 || params.some(param => param.type !== 'Identifier') ||
            body?.type !== 'JSXElement') return false;
        const item = astBindingAt(ctx, params[0]!, identifierName(params[0])!);
        const index = params[1] && astBindingAt(ctx, params[1], identifierName(params[1])!);
        if (item === undefined || item.constantViolations.length !== 0 || index?.constantViolations.length) return false;
        const itemField = (node: BaseNode): boolean => node.type === 'MemberExpression' &&
          sameBinding(childNode(node, 'object'), item) && knownFields.has(property(node) ?? '');
        const stableIdentifier = (identifier: BaseNode): boolean => {
          if (index !== undefined && sameBinding(identifier, index)) return true;
          if (!publishedDependency(identifier)) return false;
          const comparison = parents.get(identifier);
          if (comparison?.type !== 'BinaryExpression' ||
              !['===', '!=='].includes(String(nodeField(comparison, 'operator')))) return false;
          const other = childNode(comparison, childNode(comparison, 'left') === identifier ? 'right' : 'left');
          // Strict equality cannot invoke coercion on the dependency.
          return other !== null && itemField(other);
        };
        for (const reference of item.references) {
          const use = parents.get(reference);
          if (use == null || !itemField(use) || !readOnly(use)) return false;
        }
        let pure = true;
        walkAst(body, { enter(node) {
          if (!pure) return false;
          if (node.type === 'JSXAttribute') {
            const name = identifierName(childNode(node, 'name')) ?? nodeField(childNode(node, 'name')!, 'name');
            if (name === 'ref') { pure = false; return false; }
            if (typeof name === 'string' && /^on[A-Z]/.test(name)) return false;
          }
          if (node.type === 'JSXElement') {
            const tag = childNode(childNode(node, 'openingElement')!, 'name');
            const name = tag && nodeField(tag, 'name');
            if (tag?.type !== 'JSXIdentifier' || typeof name !== 'string' || !/^[a-z]/.test(name)) pure = false;
          }
          if (node.type === 'JSXSpreadAttribute' || node.type === 'JSXSpreadChild' || node.type === 'JSXFragment') pure = false;
          if (node.type === 'JSXExpressionContainer') {
            pure &&= isPlainScalarValue(childNode(node, 'expression'), stableIdentifier, itemField);
            return false;
          }
        }});
        return pure;
      };
      for (const reference of binding.references) {
        const use = parents.get(reference);
        if (safeArguments.has(reference)) continue;
        if (use?.type === 'AssignmentExpression' && childNode(use, 'left') === reference) continue;
        if (use?.type !== 'MemberExpression' || childNode(use, 'object') !== reference || nodeField(use, 'optional') === true) { valid = false; break; }
        const consumer = parents.get(use);
        if (property(use) === 'length') {
          if (!readOnly(use) && (consumer?.type !== 'AssignmentExpression' ||
              nodeField(consumer, 'operator') !== '=' || nodeField(childNode(consumer, 'right')!, 'value') !== minimumLength)) valid = false;
          else if (!readOnly(use)) structuralWrites.add(consumer!);
        } else if (indexedItem(use)) {
          if (consumer?.type === 'ArrayExpression' && arrayElements.has(use)) continue;
          if (consumer?.type === 'AssignmentExpression' &&
              (childNode(consumer, 'left') === use || indexedItem(childNode(consumer, 'left')!) && childNode(consumer, 'right') === use)) {
            structuralWrites.add(consumer); continue;
          }
          if (consumer?.type !== 'MemberExpression' || !knownFields.has(property(consumer) ?? '')) valid = false;
          else if (!readOnly(consumer)) {
            if (!contentWrite(consumer)) valid = false;
            else mutableContents = true;
          }
        } else if (property(use) === 'map' && consumer != null &&
            childNode(consumer, 'callee') === use && ctx.analyzedListSources.has(consumer as MapCallExpression) && pureRow(consumer)) {
          calls.push(consumer as MapCallExpression);
        } else valid = false;
        if (!valid) break;
      }
      if (!valid || calls.length === 0) continue;
      const guarded = [...operations.values()].some(methods => methods.length !== 0);
      // Content-write publication and native-call effects require separate
      // causes before they can share one proof. Retain ordinary replay here.
      if (guarded && mutableContents) continue;
      if (mutableContents && structuralWrites.size === 0) continue;
      if (guarded) {
        const token = generatedIdentifier(ctx, `${source}Provenance`).name;
        let slots = ctx.ownerListProvenance.get(owner);
        if (slots === undefined) ctx.ownerListProvenance.set(owner, slots = new Map());
        slots.set(source, token);
        for (const [write, methods] of operations) {
          const guards = new Set<string>();
          for (const method of methods) {
            if (method === 'iterator') guards.add('iterator');
            else for (const guard of LIST_METHOD_OPTIMIZATIONS[method]?.guards ?? []) guards.add(guard);
          }
          ctx.ownerListOperations.set(write as t.Node, { owner, token, operations: methods.filter(method => method !== 'iterator'),
            guards: [...guards].sort(), fresh: freshWrites.get(write)! });
        }
      }
      for (const call of calls) ctx.ownerListStructureSources.set(call, source);
      const sources = new Set([...(ctx.instanceReasonIds.get(owner)?.keys() ?? []), source]);
      if (mutableContents) {
        const reasonKey = `${source}\0memo-dom:owner-list-structure`;
        let reasons = ctx.ownerListStructureReasonKeys.get(owner);
        if (reasons === undefined) ctx.ownerListStructureReasonKeys.set(owner, reasons = new Map());
        reasons.set(source, reasonKey); sources.add(reasonKey);
        for (const write of structuralWrites) ctx.ownerListStructureWriteSources.set(write as t.Node, { owner, source });
      }
      ctx.instanceReasonIds.set(owner, new Map([...sources].sort().map((name, index) => [name, index])));
    }
  }
}

/** Transfer original write facts only through the handler's exact deep clone. */
export function captureOwnerListWrites(ctx: Ctx, owner: string | null, original: t.Node, copy: t.Node): CapturedOwnerListWrites {
  const writes = new WeakMap<t.Node, string>();
  const operations: Array<{ assignment: t.AssignmentExpression; plan: OwnerListOperation }> = [];
  const captured = { structuralWrites: writes, operations };
  if (owner === null || !ctx.ownerListStructureReasonKeys.has(owner) && !ctx.ownerListProvenance.has(owner)) return captured;
  const pair = (source: BaseNode, target: BaseNode): void => {
    if (source.type !== target.type) return;
    const fact = ctx.ownerListStructureWriteSources.get(source as t.Node);
    if (fact?.owner === owner) writes.set(target as t.Node, fact.source);
    const operation = ctx.ownerListOperations.get(source as t.Node);
    if (operation?.owner === owner && target.type === 'AssignmentExpression') {
      operations.push({ assignment: target as t.AssignmentExpression, plan: operation });
    }
    for (const key of ESTREE_VISITOR_KEYS[source.type] ?? []) {
      const child = childNode(source, key), cloned = childNode(target, key);
      if (child !== null && cloned !== null) pair(child, cloned);
      else {
        const children = childNodes(source, key), copies = childNodes(target, key);
        if (children.length === copies.length) children.forEach((node, index) => pair(node, copies[index]!));
      }
    }
  };
  pair(original, copy); return captured;
}
