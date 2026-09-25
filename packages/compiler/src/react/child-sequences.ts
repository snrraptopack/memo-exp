/**
 * Finite React child sequences are analyzed at the caller, before MMD turns
 * children into lazy mount slots. Counts travel as scalar props; mapped
 * children travel as individual caller-owned slots to callee-owned wrappers.
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
      indexParameter?: string };

type RenderValue =
  | { kind: 'element'; source: t.JSXElement }
  | { kind: 'fragment'; source: t.JSXFragment }
  | { kind: 'text'; source: t.JSXText | t.Expression }
  | { kind: 'empty'; source: t.Expression };

interface ChildSequence {
  owner: ModuleEntry;
  values: RenderValue[];
  rootEmpty: boolean;
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
  return { kind: 'map', call, slots: [], wrapper: returned, parameter, indexParameter };
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
  function fresh(kind: 'Count' | 'MapSlot'): string {
    let name: string;
    do { name = `__mmdReactChild${kind}${serial++}`; } while (occupied.has(name));
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
  const injections: Array<{ element: t.JSXElement; template: ChildTemplate;
    sequence: ChildSequence }> = [];
  const reached = new Set<ChildTemplate>();
  for (const entry of entries.values()) {
    const analysis = analyzeScope(entry.ast);
    walkAst(entry.ast as BaseNode, { enter(node) {
      if (!ast.isJSXElement(node) || !ast.isJSXIdentifier(node.openingElement.name)) return;
      const name = node.openingElement.name.name;
      const binding = analysis.nodeToScope.get(node)?.getBinding(name);
      let template: ChildTemplate | undefined;
      if (binding?.kind === 'import' && ast.isImportDeclaration(binding.declarationNode)) {
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
      injections.push({ element: node, template, sequence });
      reached.add(template);
    } });
  }
  for (const template of templates.values()) {
    if (!reached.has(template)) {
      fail(template.entry, `component '${template.name}' has no finite linked caller`, template.owner);
    }
    const callers = injections.filter(injection => injection.template === template);
    for (const operation of template.operations) {
      if (operation.kind !== 'map') continue;
      const length = callers.reduce((max, { sequence }) =>
        Math.max(max, sequence.rootEmpty ? 0 : sequence.values.length), 0);
      operation.slots = Array.from({ length }, () => fresh('MapSlot'));
    }
  }

  for (const { element, template, sequence } of injections) {
    for (const operation of template.operations) {
      if (operation.kind === 'count') {
        element.openingElement.attributes.push(ast.jsxAttribute(ast.jsxIdentifier(operation.prop),
          ast.jsxExpressionContainer(ast.numericLiteral(sequence.rootEmpty ? 0 : sequence.values.length))));
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
      const props = operation.kind === 'count' ? [operation.prop] : operation.slots;
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
        else mapped.set(operation.call, mappedOutput(operation).children);
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
