/**
 * React child sequences are analyzed at the caller before MMD turns children
 * into owned mount slots or keyed list rows.
 */
import type * as t from '../ast/compiler-types';
import * as ast from '../ast/factory';
import { analyzeScope, cloneNode, isReferenceIdentifier, walkAst, type BaseNode } from '../ast';
import { isReactPackageModule } from '../context';
import { compilerError } from '../errors';
import type { CompileModulesOptions, ModuleEntry } from '../linking/model';
import { resolveModule } from '../linking/resolution';

interface ChildTemplate {
  entry: ModuleEntry;
  name: string;
  exported: boolean;
  owner: t.FunctionDeclaration;
  operations: ChildOperation[];
}

type ChildOperation =
  | { kind: 'count'; call: t.CallExpression; prop: string }
  | { kind: 'map'; call: t.CallExpression; slots: string[];
      wrapper: t.JSXElement | t.JSXFragment; parameter: string;
      indexParameter?: string; intrinsic: boolean; componentRoot?: string;
      nestedComponent: boolean; captures: string[];
      dynamicComponent?: { local: string; exported: string };
      dynamicProps?: { items: string; renderItem: string; item: string; index: string;
        context: string } };

type RenderValue =
  | { kind: 'element'; source: t.JSXElement }
  | { kind: 'fragment'; source: t.JSXFragment }
  | { kind: 'text'; source: t.JSXText | t.Expression }
  | { kind: 'empty'; source: t.Expression };

interface ChildSequence {
  owner: ModuleEntry;
  values: RenderValue[];
  rootEmpty: boolean;
  dynamic?: { source: t.Identifier; jsx: t.JSXElement;
    item: t.Identifier; index?: t.Identifier };
}

function fail(entry: ModuleEntry, message: string, node: BaseNode): never {
  throw compilerError(`memo-dom: React child sequence ${message}`, entry.id, node);
}

function ownerOf(analysis: ReturnType<typeof analyzeScope>, node: BaseNode): t.FunctionDeclaration | null {
  let parent = analysis.parentByNode.get(node) ?? null;
  while (parent !== null) {
    if (ast.isFunction(parent)) return ast.isFunctionDeclaration(parent) ? parent : null;
    parent = analysis.parentByNode.get(parent) ?? null;
  }
  return null;
}

function childParameter(owner: t.FunctionDeclaration): t.Identifier | null {
  if (owner.params.length !== 1 || !ast.isObjectPattern(owner.params[0])) return null;
  const property = owner.params[0].properties.find(item =>
    ast.isObjectProperty(item) && !item.computed && ast.isIdentifier(item.key) &&
    item.key.name === 'children');
  return property !== undefined && ast.isObjectProperty(property) && ast.isIdentifier(property.value)
    ? property.value : null;
}

function planChildren(entry: ModuleEntry, children: t.JSXElement['children']): ChildSequence {
  const meaningful = children.filter(child => !ast.isJSXText(child) || child.value.trim() !== '');
  if (meaningful.length === 1 && ast.isJSXExpressionContainer(meaningful[0])) {
    const expression = meaningful[0].expression;
    if (ast.isCallExpression(expression) && ast.isMemberExpression(expression.callee) &&
        !expression.callee.computed && ast.isIdentifier(expression.callee.property, { name: 'map' }) &&
        ast.isIdentifier(expression.callee.object) && expression.arguments.length === 1 &&
        ast.isArrowFunctionExpression(expression.arguments[0])) {
      const callback = expression.arguments[0];
      const returned = ast.isBlockStatement(callback.body) && callback.body.body.length === 1 &&
        ast.isReturnStatement(callback.body.body[0]) ? callback.body.body[0].argument : callback.body;
      if (callback.params.length < 1 || callback.params.length > 2 ||
          callback.params.some(param => !ast.isIdentifier(param)) || !ast.isJSXElement(returned)) {
        fail(entry, 'requires an inline list map callback returning one JSX element', expression);
      }
      const params = callback.params as t.Identifier[];
      return { owner: entry, values: [], rootEmpty: false,
        dynamic: { source: expression.callee.object, jsx: returned,
          item: params[0]!, index: params[1] } };
    }
  }
  const values: RenderValue[] = [];
  for (const child of children) {
    if (ast.isJSXText(child)) {
      if (child.value.trim() !== '') values.push({ kind: 'text', source: child });
    } else if (ast.isJSXElement(child)) {
      values.push({ kind: 'element', source: child });
    } else if (ast.isJSXFragment(child)) {
      values.push({ kind: 'fragment', source: child });
    } else if (ast.isJSXExpressionContainer(child)) {
      const value = child.expression;
      if (ast.isJSXEmptyExpression(value)) continue;
      if (ast.isJSXElement(value)) {
        values.push({ kind: 'element', source: value });
      } else if (ast.isJSXFragment(value)) {
        values.push({ kind: 'fragment', source: value });
      } else if (ast.isNullLiteral(value) || ast.isBooleanLiteral(value)) {
        values.push({ kind: 'empty', source: value });
      } else if (ast.isStringLiteral(value) || ast.isNumericLiteral(value)) {
        values.push({ kind: 'text', source: value });
      } else {
        fail(entry, 'requires a finite JSX child sequence', child);
      }
    } else {
      fail(entry, 'cannot count spread or unknown JSX children', child);
    }
  }
  return { owner: entry, values,
    rootEmpty: values.length === 1 && values[0]!.kind === 'empty' };
}

function mapOperation(
  entry: ModuleEntry, analysis: ReturnType<typeof analyzeScope>,
  call: t.CallExpression,
): ChildOperation {
  const callback = call.arguments[1];
  if (call.arguments.length !== 2 || !ast.isArrowFunctionExpression(callback) || callback.async ||
      callback.params.length < 1 || callback.params.length > 2 ||
      callback.params.some(param => !ast.isIdentifier(param))) {
    fail(entry, 'requires Children.map(children, child => <JSX />)', call);
  }
  const returned = ast.isBlockStatement(callback.body) && callback.body.body.length === 1 &&
    ast.isReturnStatement(callback.body.body[0]) ? callback.body.body[0].argument : callback.body;
  if (!ast.isJSXElement(returned) && !ast.isJSXFragment(returned)) {
    fail(entry, 'requires a JSX return from the map callback', callback);
  }
  const parameters = callback.params as t.Identifier[];
  const parameter = parameters[0]!.name;
  const indexParameter = parameters[1]?.name;
  if (indexParameter === parameter) fail(entry, 'requires distinct child and index parameters', callback);
  const binding = analysis.nodeToScope.get(parameters[0]!)?.getBinding(parameter);
  const indexBinding = indexParameter === undefined ? undefined :
    analysis.nodeToScope.get(parameters[1]!)?.getBinding(indexParameter);
  if (binding === undefined || binding.references.length !== 1) {
    fail(entry, 'requires one direct child insertion in the map wrapper', callback);
  }
  const reference = binding.references[0]!;
  const container = analysis.parentByNode.get(reference);
  const parent = container == null ? null : analysis.parentByNode.get(container);
  if (!ast.isJSXExpressionContainer(container) || container.expression !== reference ||
      (!ast.isJSXElement(parent) && !ast.isJSXFragment(parent)) ||
      !parent.children.includes(container)) {
    fail(entry, 'requires the mapped child directly in JSX children', reference);
  }
  const callContainer = analysis.parentByNode.get(call);
  const callParent = callContainer == null ? null : analysis.parentByNode.get(callContainer);
  if (!ast.isJSXExpressionContainer(callContainer) || callContainer.expression !== call ||
      (!ast.isJSXElement(callParent) && !ast.isJSXFragment(callParent)) ||
      !callParent.children.includes(callContainer)) {
    fail(entry, 'requires Children.map directly in rendered JSX', call);
  }
  walkAst(returned as BaseNode, { enter(node, parentNode, key) {
    if (!ast.isIdentifier(node) || !isReferenceIdentifier(parentNode, key)) return;
    if (node.name !== parameter && node.name !== indexParameter) return;
    const resolved = analysis.nodeToScope.get(node)?.getBinding(node.name);
    if (resolved !== (node.name === parameter ? binding : indexBinding)) {
      fail(entry, 'cannot shadow a map callback parameter inside its JSX wrapper', node);
    }
  } });
  let intrinsic = true;
  let nestedComponent = false;
  const componentRoot = ast.isJSXElement(returned) && ast.isJSXIdentifier(returned.openingElement.name) &&
    /^[A-Z]/.test(returned.openingElement.name.name) ? returned.openingElement.name.name : undefined;
  const captures = new Set<string>();
  const wrapperNodes = new Set<BaseNode>();
  walkAst(returned as BaseNode, { enter(node) { wrapperNodes.add(node); } });
  walkAst(returned as BaseNode, { enter(node, parentNode, key) {
    if (ast.isJSXElement(node) && (!ast.isJSXIdentifier(node.openingElement.name) ||
        /^[A-Z]/.test(node.openingElement.name.name))) {
      intrinsic = false;
      if (node !== returned) nestedComponent = true;
    }
    if (!ast.isIdentifier(node) || !isReferenceIdentifier(parentNode, key)) return;
    const resolved = analysis.nodeToScope.get(node)?.getBinding(node.name);
    if (resolved !== binding && resolved !== indexBinding &&
        (resolved === undefined || !wrapperNodes.has(resolved.declarationNode))) {
      captures.add(node.name);
    }
  } });
  walkAst(returned as BaseNode, { enter(node, parentNode, key) {
    if (!ast.isIdentifier(node) || !isReferenceIdentifier(parentNode, key) ||
        !captures.has(node.name)) return;
    const resolved = analysis.nodeToScope.get(node)?.getBinding(node.name);
    if (resolved !== undefined && wrapperNodes.has(resolved.declarationNode)) {
      fail(entry, 'cannot shadow a captured value inside a dynamic map wrapper', node);
    }
  } });
  return { kind: 'map', call, slots: [], wrapper: returned, parameter, indexParameter,
    intrinsic, componentRoot, nestedComponent, captures: [...captures] };
}

function childSlotValue(value: RenderValue): t.JSXFragment {
  const source = cloneNode(value.source as BaseNode, true);
  const child = ast.isJSXText(source) || ast.isJSXElement(source) || ast.isJSXFragment(source)
    ? source : ast.jsxExpressionContainer(source as t.Expression);
  return ast.jsxFragment(ast.jsxOpeningFragment(), ast.jsxClosingFragment(), [child]);
}

function mappedWrapper(
  operation: Extract<ChildOperation, { kind: 'map' }>,
  slot: string, position: number,
): t.JSXElement | t.JSXFragment {
  const wrapper = cloneNode(operation.wrapper as BaseNode, true) as t.JSXElement | t.JSXFragment;
  walkAst(wrapper as BaseNode, { enter(node, parent, key, index) {
    if (operation.indexParameter !== undefined && ast.isIdentifier(node) &&
        node.name === operation.indexParameter && isReferenceIdentifier(parent, key) &&
        parent !== null && key !== undefined) {
      const fields = parent as unknown as Record<string, unknown>;
      const field = fields[key];
      if (index === undefined) fields[key] = ast.numericLiteral(position);
      else if (Array.isArray(field)) field[index] = ast.numericLiteral(position);
      return false;
    }
    if (ast.isJSXExpressionContainer(node) && ast.isIdentifier(node.expression) &&
        node.expression.name === operation.parameter) {
      node.expression = ast.identifier(slot);
      return false;
    }
  } });
  return wrapper;
}

function mappedOutput(operation: Extract<ChildOperation, { kind: 'map' }>): t.JSXFragment {
  const children = operation.slots.map((slot, position) =>
    ast.jsxExpressionContainer(ast.logicalExpression('&&', ast.identifier(slot),
      mappedWrapper(operation, slot, position))));
  return ast.jsxFragment(ast.jsxOpeningFragment(), ast.jsxClosingFragment(), children);
}

function dynamicWrapper(
  operation: Extract<ChildOperation, { kind: 'map' }>,
  sequence: NonNullable<ChildSequence['dynamic']>, index: string, context: string,
  componentAlias: string | undefined,
): t.JSXElement {
  const wrapper = cloneNode(operation.wrapper as BaseNode, true) as t.JSXElement;
  if (componentAlias !== undefined) {
    wrapper.openingElement.name = ast.jsxIdentifier(componentAlias);
    if (wrapper.closingElement !== null) wrapper.closingElement.name = ast.jsxIdentifier(componentAlias);
  }
  const inner = cloneNode(sequence.jsx as BaseNode, true) as t.JSXElement;
  const key = inner.openingElement.attributes.find(attribute =>
    ast.isJSXAttribute(attribute) && ast.isJSXIdentifier(attribute.name) && attribute.name.name === 'key');
  if (key !== undefined) {
    wrapper.openingElement.attributes.push(cloneNode(key as BaseNode, true) as t.JSXAttribute);
    inner.openingElement.attributes = inner.openingElement.attributes.filter(attribute => attribute !== key);
  }
  walkAst(wrapper as BaseNode, { enter(node, parent, field, position) {
    if (ast.isIdentifier(node) && operation.captures.includes(node.name) &&
        isReferenceIdentifier(parent, field) && parent !== null && field !== undefined) {
      const fields = parent as unknown as Record<string, unknown>;
      const value = fields[field];
      const captured = ast.memberExpression(ast.callExpression(ast.identifier(context), []),
        ast.identifier(node.name));
      if (position === undefined) fields[field] = captured;
      else if (Array.isArray(value)) value[position] = captured;
      return false;
    }
    if (operation.indexParameter !== undefined && ast.isIdentifier(node) &&
        node.name === operation.indexParameter && isReferenceIdentifier(parent, field) &&
        parent !== null && field !== undefined) {
      const fields = parent as unknown as Record<string, unknown>;
      const value = fields[field];
      if (position === undefined) fields[field] = ast.identifier(index);
      else if (Array.isArray(value)) value[position] = ast.identifier(index);
      return false;
    }
    if (!ast.isJSXExpressionContainer(node) || !ast.isIdentifier(node.expression) ||
        node.expression.name !== operation.parameter || parent === null ||
        field !== 'children' || position === undefined) return;
    (parent as t.JSXElement | t.JSXFragment).children[position] = inner;
    return false;
  } });
  return wrapper;
}

function dynamicMapCall(operation: Extract<ChildOperation, { kind: 'map' }>): t.JSXExpressionContainer {
  const props = operation.dynamicProps!;
  const context = ast.arrowFunctionExpression([], ast.objectExpression(operation.captures.map(name =>
    ast.objectProperty(ast.identifier(name), ast.identifier(name), false, true))));
  return ast.jsxExpressionContainer(ast.callExpression(
    ast.memberExpression(ast.identifier(props.items), ast.identifier('map')),
    [ast.arrowFunctionExpression([ast.identifier(props.item), ast.identifier(props.index)],
      ast.callExpression(ast.identifier(props.renderItem),
        [ast.identifier(props.item), ast.identifier(props.index),
          ...(operation.captures.length === 0 ? [] : [context])]))],
  ));
}

export function specializeLinkedReactChildSequences(
  entries: ReadonlyMap<string, ModuleEntry>, options: CompileModulesOptions,
): void {
  const packages = options.react?.packages ?? [];
  const templates = new Map<string, ChildTemplate>();
  const consumedImports = new Set<t.ImportDeclaration>();
  const occupied = new Set<string>();
  for (const entry of entries.values()) {
    walkAst(entry.ast as BaseNode, { enter(node) {
      if (ast.isIdentifier(node) || ast.isJSXIdentifier(node)) occupied.add(node.name);
    } });
  }
  let serial = 0;
  function fresh(kind: 'Count' | 'MapSlot' | 'Items' | 'RenderItem' | 'Item' | 'Index' |
    'Context' | 'WrapperExport' | 'WrapperImport'): string {
    let name: string;
    do { name = `${kind === 'WrapperImport' ? 'MmdReactChild' : '__mmdReactChild'}${kind}${serial++}`; }
    while (occupied.has(name));
    occupied.add(name);
    return name;
  }

  for (const entry of entries.values()) {
    if (!isReactPackageModule(entry.id, packages)) continue;
    const analysis = analyzeScope(entry.ast);
    for (const statement of entry.ast.body) {
      if (!ast.isImportDeclaration(statement) || statement.source.value !== 'react') continue;
      for (const specifier of statement.specifiers) {
        if (!ast.isImportSpecifier(specifier) || !ast.isIdentifier(specifier.imported) ||
            specifier.imported.name !== 'Children') continue;
        const binding = analysis.rootScope.bindings.get(specifier.local.name);
        if (binding === undefined || binding.references.length === 0) continue;
        const uses: Array<{ owner: t.FunctionDeclaration; call: t.CallExpression;
          kind: 'count' | 'map' }> = [];
        for (const reference of binding.references) {
          const member = analysis.parentByNode.get(reference);
          const call = member == null ? null : analysis.parentByNode.get(member);
          if (!ast.isMemberExpression(member) || member.object !== reference || member.computed ||
              !ast.isIdentifier(member.property) ||
              (member.property.name !== 'count' && member.property.name !== 'map') ||
              !ast.isCallExpression(call) || call.callee !== member || call.optional ||
              (member.property.name === 'count' && call.arguments.length !== 1) ||
              !ast.isIdentifier(call.arguments[0])) {
            fail(entry, 'supports direct Children.count(children) or Children.map(children, callback)', reference);
          }
          const owner = ownerOf(analysis, call);
          const parameter = owner === null ? null : childParameter(owner);
          const parent = owner === null ? null : analysis.parentByNode.get(owner);
          if (owner?.id == null || !/^[A-Z]/.test(owner.id.name) || parameter === null ||
              call.arguments[0].name !== parameter.name ||
              (parent?.type !== 'Program' && parent?.type !== 'ExportNamedDeclaration')) {
            fail(entry, 'requires a Children operation on a top-level component child parameter', call);
          }
          const paramBinding = analysis.nodeToScope.get(parameter)?.getBinding(parameter.name);
          const argBinding = analysis.nodeToScope.get(call.arguments[0])?.getBinding(parameter.name);
          if (paramBinding === undefined || argBinding !== paramBinding) {
            fail(entry, 'requires the original component child parameter', call);
          }
          uses.push({ owner, call, kind: member.property.name as 'count' | 'map' });
        }
        for (const use of uses) {
          const key = `${entry.id}#${use.owner.id!.name}`;
          let template = templates.get(key);
          if (template === undefined) {
            template = { entry, name: use.owner.id!.name,
              exported: analysis.parentByNode.get(use.owner)?.type === 'ExportNamedDeclaration',
              owner: use.owner, operations: [] };
            templates.set(key, template);
          }
          template.operations.push(use.kind === 'count'
            ? { kind: 'count', call: use.call, prop: fresh('Count') }
            : mapOperation(entry, analysis, use.call));
        }
        statement.specifiers = statement.specifiers.filter(item => item !== specifier);
        consumedImports.add(statement);
      }
    }
  }
  if (templates.size === 0) return;
  for (const template of templates.values()) {
    if (!template.operations.some(operation => operation.kind === 'map')) continue;
    const analysis = analyzeScope(template.entry.ast);
    const parameter = childParameter(template.owner)!;
    const binding = analysis.nodeToScope.get(parameter)?.getBinding(parameter.name);
    const observations = new Set(template.operations.map(operation => operation.call.arguments[0]));
    for (const reference of binding?.references ?? []) {
      if (!observations.has(reference)) {
        fail(template.entry, 'cannot render raw children alongside a mapped child sequence', reference);
      }
    }
  }

  function resolveTemplate(entry: ModuleEntry, exported: string, seen = new Set<string>()): ChildTemplate | undefined {
    const key = `${entry.id}#${exported}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const direct = templates.get(key);
    if (direct?.exported) return direct;
    for (const statement of entry.ast.body) {
      if (!ast.isExportNamedDeclaration(statement)) continue;
      for (const specifier of statement.specifiers) {
        if (!ast.isExportSpecifier(specifier) || !ast.isIdentifier(specifier.exported) ||
            specifier.exported.name !== exported || !ast.isIdentifier(specifier.local)) continue;
        if (statement.source === null) {
          const local = templates.get(`${entry.id}#${specifier.local.name}`);
          if (local !== undefined) return local;
        } else if (ast.isStringLiteral(statement.source)) {
          const target = resolveModule(entry.id, statement.source.value, entries, options);
          if (target !== undefined) {
            const found = resolveTemplate(target, specifier.local.name, seen);
            if (found !== undefined) return found;
          }
        }
      }
    }
    return undefined;
  }

  // Validate all callers before changing any component body.
  const injections: Array<{ entry: ModuleEntry; element: t.JSXElement; template: ChildTemplate;
    sequence: ChildSequence; sourceImport?: t.ImportDeclaration }> = [];
  const reached = new Set<ChildTemplate>();
  for (const entry of entries.values()) {
    const analysis = analyzeScope(entry.ast);
    walkAst(entry.ast as BaseNode, { enter(node) {
      if (!ast.isJSXElement(node) || !ast.isJSXIdentifier(node.openingElement.name)) return;
      const name = node.openingElement.name.name;
      const binding = analysis.nodeToScope.get(node)?.getBinding(name);
      let template: ChildTemplate | undefined;
      let sourceImport: t.ImportDeclaration | undefined;
      if (binding?.kind === 'import' && ast.isImportDeclaration(binding.declarationNode)) {
        sourceImport = binding.declarationNode;
        const specifier = binding.declarationNode.specifiers.find(item => item.local.name === name);
        if (ast.isImportSpecifier(specifier) && ast.isIdentifier(specifier.imported)) {
          const target = resolveModule(entry.id, String(binding.declarationNode.source.value), entries, options);
          if (target !== undefined) template = resolveTemplate(target, specifier.imported.name);
        }
      } else if (binding?.scope.isProgramScope === true) {
        template = templates.get(`${entry.id}#${name}`);
      }
      if (template === undefined) return;
      if (node.openingElement.attributes.some(attribute =>
        ast.isJSXSpreadAttribute(attribute) || ast.isJSXAttribute(attribute) &&
        ast.isJSXIdentifier(attribute.name) && template.operations.some(op =>
          op.kind === 'count' && op.prop === attribute.name.name))) {
        fail(entry, 'cannot specialize a spread or reserved child-sequence prop', node.openingElement);
      }
      const sequence = planChildren(entry, node.children);
      injections.push({ entry, element: node, template, sequence, sourceImport });
      reached.add(template);
    } });
  }
  const componentExports = new Map<string, string>();
  for (const template of templates.values()) {
    if (!reached.has(template)) {
      fail(template.entry, `component '${template.name}' has no linked caller`, template.owner);
    }
    const callers = injections.filter(injection => injection.template === template);
    const hasDynamic = callers.some(({ sequence }) => sequence.dynamic !== undefined);
    if (hasDynamic && template.operations.some(operation => operation.kind === 'map') &&
        callers.some(({ sequence }) => sequence.dynamic === undefined)) {
      fail(template.entry, 'cannot mix finite and dynamic mapped callers yet', template.owner);
    }
    for (const operation of template.operations) {
      if (operation.kind !== 'map') continue;
      if (hasDynamic) {
        if (!ast.isJSXElement(operation.wrapper) || operation.nestedComponent ||
            (!operation.intrinsic && operation.componentRoot === undefined)) {
          fail(template.entry, 'dynamic map wrapper needs an intrinsic or linked component JSX root',
            operation.call);
        }
        if (operation.componentRoot !== undefined) {
          const analysis = analyzeScope(template.entry.ast);
          const component = analysis.nodeToScope.get(operation.wrapper)?.getBinding(operation.componentRoot);
          if (component?.scope.isProgramScope !== true || component.kind !== 'function' ||
              !ast.isFunctionDeclaration(component.declarationNode)) {
            fail(template.entry, 'dynamic map wrapper component must be a top-level package function',
              operation.call);
          }
          const key = `${template.entry.id}#${operation.componentRoot}`;
          let exported = componentExports.get(key);
          if (exported === undefined) {
            exported = fresh('WrapperExport');
            componentExports.set(key, exported);
            template.entry.ast.body.push(ast.exportNamedDeclaration(null, [
              ast.exportSpecifier(ast.identifier(operation.componentRoot), ast.identifier(exported)),
            ]));
          }
          operation.dynamicComponent = { local: operation.componentRoot, exported };
        }
        if (operation.wrapper.openingElement.attributes.some(attribute =>
          ast.isJSXAttribute(attribute) && ast.isJSXIdentifier(attribute.name) &&
          attribute.name.name === 'key') && callers.some(({ sequence }) =>
            sequence.dynamic?.jsx.openingElement.attributes.some(attribute =>
              ast.isJSXAttribute(attribute) && ast.isJSXIdentifier(attribute.name) &&
              attribute.name.name === 'key'))) {
          fail(template.entry, 'cannot combine package and caller row keys', operation.call);
        }
        operation.dynamicProps = { items: fresh('Items'), renderItem: fresh('RenderItem'),
          item: fresh('Item'), index: fresh('Index'), context: fresh('Context') };
        continue;
      }
      const length = callers.reduce((max, { sequence }) =>
        Math.max(max, sequence.rootEmpty ? 0 : sequence.values.length), 0);
      operation.slots = Array.from({ length }, () => fresh('MapSlot'));
    }
  }

  const componentImports = new Map<t.ImportDeclaration, Map<string, string>>();
  for (const { entry, element, template, sequence, sourceImport } of injections) {
    for (const operation of template.operations) {
      if (operation.kind === 'count') {
        const count = sequence.dynamic === undefined
          ? ast.numericLiteral(sequence.rootEmpty ? 0 : sequence.values.length)
          : ast.memberExpression(cloneNode(sequence.dynamic.source as BaseNode, true) as t.Identifier,
            ast.identifier('length'));
        element.openingElement.attributes.push(ast.jsxAttribute(ast.jsxIdentifier(operation.prop),
          ast.jsxExpressionContainer(count)));
      } else if (operation.dynamicProps !== undefined && sequence.dynamic !== undefined) {
        let componentAlias: string | undefined;
        if (operation.dynamicComponent !== undefined) {
          componentAlias = operation.dynamicComponent.local;
          if (entry !== template.entry) {
            if (sourceImport === undefined || resolveModule(entry.id, sourceImport.source.value,
              entries, options) !== template.entry) {
              fail(entry, 'dynamic package wrapper requires a direct component import', element);
            }
            const imported = componentImports.get(sourceImport) ?? new Map<string, string>();
            componentImports.set(sourceImport, imported);
            let alias = imported.get(operation.dynamicComponent.exported);
            if (alias === undefined) {
              alias = fresh('WrapperImport');
              imported.set(operation.dynamicComponent.exported, alias);
              sourceImport.specifiers.push(ast.importSpecifier(ast.identifier(alias),
                ast.identifier(operation.dynamicComponent.exported)));
            }
            componentAlias = alias;
          }
        }
        const index = sequence.dynamic.index?.name ?? fresh('Index');
        const params = [cloneNode(sequence.dynamic.item as BaseNode, true) as t.Identifier,
          ast.identifier(index),
          ...(operation.captures.length === 0 ? [] : [ast.identifier(operation.dynamicProps.context)])];
        element.openingElement.attributes.push(
          ast.jsxAttribute(ast.jsxIdentifier(operation.dynamicProps.items),
            ast.jsxExpressionContainer(cloneNode(sequence.dynamic.source as BaseNode, true) as t.Identifier)),
          ast.jsxAttribute(ast.jsxIdentifier(operation.dynamicProps.renderItem),
            ast.jsxExpressionContainer(ast.arrowFunctionExpression(
              params, dynamicWrapper(operation, sequence.dynamic, index,
                operation.dynamicProps.context, componentAlias),
            ))),
        );
      } else if (!sequence.rootEmpty) {
        for (const [position, value] of sequence.values.entries()) {
          element.openingElement.attributes.push(ast.jsxAttribute(ast.jsxIdentifier(operation.slots[position]!),
            ast.jsxExpressionContainer(childSlotValue(value))));
        }
      }
    }
    if (template.operations.some(operation => operation.kind === 'map')) element.children = [];
  }
  for (const template of templates.values()) {
    const param = template.owner.params[0] as t.ObjectPattern;
    for (const operation of template.operations) {
      const props = operation.kind === 'count' ? [operation.prop] : operation.dynamicProps === undefined
        ? operation.slots : [operation.dynamicProps.items, operation.dynamicProps.renderItem];
      for (const prop of props) {
        param.properties.push(ast.objectProperty(ast.identifier(prop),
          ast.identifier(prop), false, true));
      }
    }
  }
  for (const entry of entries.values()) {
    const replacements = new Map<BaseNode, t.Expression>();
    const mapped = new Map<BaseNode, t.JSXFragment['children']>();
    for (const template of templates.values()) {
      if (template.entry !== entry) continue;
      for (const operation of template.operations) {
        if (operation.kind === 'count') replacements.set(operation.call, ast.identifier(operation.prop));
        else mapped.set(operation.call, operation.dynamicProps === undefined
          ? mappedOutput(operation).children : [dynamicMapCall(operation)]);
      }
    }
    const splices: Array<{ parent: t.JSXElement | t.JSXFragment; index: number;
      children: t.JSXFragment['children'] }> = [];
    if (mapped.size > 0) {
      walkAst(entry.ast as BaseNode, { enter(node, parent, key, index) {
        if (!ast.isJSXExpressionContainer(node) || parent === null || key !== 'children' ||
            index === undefined || (!ast.isJSXElement(parent) && !ast.isJSXFragment(parent))) return;
        const children = mapped.get(node.expression);
        if (children !== undefined) splices.push({ parent, index, children });
      } });
      for (const splice of splices.reverse()) {
        splice.parent.children.splice(splice.index, 1, ...splice.children);
      }
    }
    if (replacements.size === 0) continue;
    walkAst(entry.ast as BaseNode, { enter(node, parent, key, index) {
      const replacement = replacements.get(node);
      if (replacement === undefined || parent === null || key === undefined) return;
      const fields = parent as unknown as Record<string, unknown>;
      const field = fields[key];
      if (index === undefined) {
        fields[key] = replacement;
      } else if (Array.isArray(field)) {
        field[index] = replacement;
      }
      return false;
    } });
  }
  for (const entry of entries.values()) {
    entry.ast.body = entry.ast.body.filter(statement =>
      !ast.isImportDeclaration(statement) || !consumedImports.has(statement) ||
      statement.specifiers.length > 0);
  }
}
