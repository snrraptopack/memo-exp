/**
 * Finite React child sequences are analyzed at the caller, before MMD turns
 * children into a lazy mount slot. The first supported observation is count.
 * Its result travels as a scalar prop; the actual children stay caller-owned.
 */
import type * as t from '../ast/compiler-types';
import * as ast from '../ast/factory';
import { analyzeScope, walkAst, type BaseNode } from '../ast';
import { isReactPackageModule } from '../context';
import { compilerError } from '../errors';
import type { CompileModulesOptions, ModuleEntry } from '../linking/model';
import { resolveModule } from '../linking/resolution';

interface ChildTemplate {
  entry: ModuleEntry;
  name: string;
  exported: boolean;
  owner: t.FunctionDeclaration;
  calls: t.CallExpression[];
  prop: string;
}

type RenderValue =
  | { kind: 'element'; source: t.JSXElement }
  | { kind: 'fragment'; source: t.JSXFragment }
  | { kind: 'text'; source: t.JSXText | t.Expression }
  | { kind: 'empty'; source: t.Expression };

interface ChildSequence {
  owner: ModuleEntry;
  values: RenderValue[];
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
        fail(entry, 'requires a finite JSX child sequence for Children.count', child);
      }
    } else {
      fail(entry, 'cannot count spread or unknown JSX children', child);
    }
  }
  return { owner: entry, values };
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
  function fresh(): string {
    let name: string;
    do { name = `__mmdReactChildCount${serial++}`; } while (occupied.has(name));
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
        const uses: Array<{ owner: t.FunctionDeclaration; call: t.CallExpression }> = [];
        for (const reference of binding.references) {
          const member = analysis.parentByNode.get(reference);
          const call = member == null ? null : analysis.parentByNode.get(member);
          if (!ast.isMemberExpression(member) || member.object !== reference || member.computed ||
              !ast.isIdentifier(member.property) || member.property.name !== 'count' ||
              !ast.isCallExpression(call) || call.callee !== member || call.optional ||
              call.arguments.length !== 1 || !ast.isIdentifier(call.arguments[0])) {
            fail(entry, 'supports only a direct Children.count(children) observation', reference);
          }
          const owner = ownerOf(analysis, call);
          const parameter = owner === null ? null : childParameter(owner);
          const parent = owner === null ? null : analysis.parentByNode.get(owner);
          if (owner?.id == null || !/^[A-Z]/.test(owner.id.name) || parameter === null ||
              call.arguments[0].name !== parameter.name ||
              (parent?.type !== 'Program' && parent?.type !== 'ExportNamedDeclaration')) {
            fail(entry, 'requires Children.count on a top-level component child parameter', call);
          }
          const paramBinding = analysis.nodeToScope.get(parameter)?.getBinding(parameter.name);
          const argBinding = analysis.nodeToScope.get(call.arguments[0])?.getBinding(parameter.name);
          if (paramBinding === undefined || argBinding !== paramBinding) {
            fail(entry, 'requires the original component child parameter', call);
          }
          uses.push({ owner, call });
        }
        for (const use of uses) {
          const key = `${entry.id}#${use.owner.id!.name}`;
          let template = templates.get(key);
          if (template === undefined) {
            template = { entry, name: use.owner.id!.name,
              exported: analysis.parentByNode.get(use.owner)?.type === 'ExportNamedDeclaration',
              owner: use.owner, calls: [], prop: fresh() };
            templates.set(key, template);
          }
          template.calls.push(use.call);
        }
        statement.specifiers = statement.specifiers.filter(item => item !== specifier);
        consumedImports.add(statement);
      }
    }
  }
  if (templates.size === 0) return;

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
  const injections: Array<{ element: t.JSXElement; template: ChildTemplate; count: number }> = [];
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
        ast.isJSXIdentifier(attribute.name) && attribute.name.name === template.prop)) {
        fail(entry, 'cannot specialize a spread or reserved child-count prop', node.openingElement);
      }
      const sequence = planChildren(entry, node.children);
      injections.push({ element: node, template, count: sequence.values.length });
      reached.add(template);
    } });
  }
  for (const template of templates.values()) {
    if (!reached.has(template)) {
      fail(template.entry, `component '${template.name}' has no finite linked caller`, template.owner);
    }
  }

  for (const { element, template, count } of injections) {
    element.openingElement.attributes.push(ast.jsxAttribute(ast.jsxIdentifier(template.prop),
      ast.jsxExpressionContainer(ast.numericLiteral(count))));
  }
  for (const template of templates.values()) {
    const param = template.owner.params[0] as t.ObjectPattern;
    param.properties.push(ast.objectProperty(ast.identifier(template.prop), ast.identifier(template.prop), false, true));
  }
  for (const entry of entries.values()) {
    const replacements = new Map<BaseNode, string>();
    for (const template of templates.values()) {
      if (template.entry !== entry) continue;
      for (const call of template.calls) replacements.set(call, template.prop);
    }
    if (replacements.size === 0) continue;
    walkAst(entry.ast as BaseNode, { enter(node, parent, key, index) {
      const prop = replacements.get(node);
      if (prop === undefined || parent === null || key === undefined) return;
      const fields = parent as unknown as Record<string, unknown>;
      const field = fields[key];
      if (index === undefined) {
        fields[key] = ast.identifier(prop);
      } else if (Array.isArray(field)) {
        field[index] = ast.identifier(prop);
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
