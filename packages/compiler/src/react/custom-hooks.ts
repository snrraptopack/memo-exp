/**
 * Specialize exported React hooks while the source graph is still available.
 * The expanded statements enter the ordinary React-to-MMD operation planner;
 * hook definitions and imports have no runtime representation.
 */
import type * as t from '../ast/compiler-types';
import * as ast from '../ast/factory';
import { analyzeScope, cloneNode, isReferenceIdentifier, walkAst, type BaseNode, type Binding } from '../ast';
import { nodeHasJsx, isReactPackageModule } from '../context';
import { compilerError } from '../errors';
import type { CompileModulesOptions, ModuleEntry } from '../linking/model';
import { resolveModule } from '../linking/resolution';

interface HookTemplate {
  entry: ModuleEntry;
  exportStatement: t.ExportNamedDeclaration;
  declaration: t.FunctionDeclaration;
  reactImports: Map<string, string>;
  resultNames: string[];
}

interface HookUse {
  template: HookTemplate;
  importStatement: t.ImportDeclaration;
  importSpecifier: t.ImportSpecifier;
  statement: t.VariableDeclaration;
  call: t.CallExpression;
  resultNames: string[];
}

function copy<T>(node: T): T {
  return cloneNode(node as BaseNode, true) as T;
}

function fail(entry: ModuleEntry, message: string, node: BaseNode): never {
  throw compilerError(`memo-dom: React custom hook ${message}`, entry.id, node);
}

function nearestFunction(
  analysis: ReturnType<typeof analyzeScope>, node: BaseNode,
): t.FunctionDeclaration | null {
  let parent = analysis.parentByNode.get(node) ?? null;
  while (parent !== null) {
    if (ast.isFunction(parent)) return ast.isFunctionDeclaration(parent) ? parent : null;
    parent = analysis.parentByNode.get(parent) ?? null;
  }
  return null;
}

function componentOwner(
  analysis: ReturnType<typeof analyzeScope>, call: t.CallExpression,
): t.FunctionDeclaration | null {
  const owner = nearestFunction(analysis, call);
  if (owner?.id == null || !/^[A-Z]/.test(owner.id.name) || !nodeHasJsx(owner.body)) return null;
  const parent = analysis.parentByNode.get(owner);
  if (parent?.type === 'Program') return owner;
  if (parent?.type === 'ExportNamedDeclaration' || parent?.type === 'ExportDefaultDeclaration') {
    return analysis.parentByNode.get(parent)?.type === 'Program' ? owner : null;
  }
  return null;
}

function templateFor(
  entry: ModuleEntry, statement: t.ExportNamedDeclaration,
  declaration: t.FunctionDeclaration,
  analysis: ReturnType<typeof analyzeScope>,
): HookTemplate | null {
  if (declaration.id == null || !/^use[A-Z]/.test(declaration.id.name)) return null;
  const reactImports = new Map<string, string>();
  let hasReactUse = false;
  walkAst(declaration.body as BaseNode, { enter(node, parent, key) {
    if (!ast.isIdentifier(node) || !isReferenceIdentifier(parent, key)) return;
    const binding = analysis.nodeToScope.get(node)?.getBinding(node.name);
    if (binding?.kind === 'import' && ast.isImportDeclaration(binding.declarationNode) &&
        binding.declarationNode.source.value === 'react') hasReactUse = true;
  } });
  if (!hasReactUse) return null;
  walkAst(declaration.body as BaseNode, { enter(node, parent, key) {
    if (!ast.isIdentifier(node) || !isReferenceIdentifier(parent, key)) return;
    const binding = analysis.nodeToScope.get(node)?.getBinding(node.name);
    if (binding?.scope.isProgramScope !== true) return;
    if (binding.kind !== 'import' || !ast.isImportDeclaration(binding.declarationNode) ||
        binding.declarationNode.source.value !== 'react') {
      fail(entry, ` '${declaration.id!.name}' captures module binding '${node.name}'`, node);
    }
    const specifier = binding.declarationNode.specifiers.find(item => item.local.name === node.name);
    if (!ast.isImportSpecifier(specifier) || !ast.isIdentifier(specifier.imported)) {
      fail(entry, ` '${declaration.id!.name}' requires a named React API import`, node);
    }
    if (!ast.isCallExpression(parent) || parent.callee !== node || parent.optional) {
      fail(entry, ` '${declaration.id!.name}' uses '${node.name}' outside a direct call`, node);
    }
    reactImports.set(node.name, specifier.imported.name);
  } });
  const body = declaration.body.body;
  const last = body.at(-1);
  if (!ast.isReturnStatement(last) || !ast.isArrayExpression(last.argument) ||
      last.argument.elements.length === 0 ||
      last.argument.elements.some(element => !ast.isIdentifier(element))) {
    fail(entry, ` '${declaration.id.name}' must return a fixed tuple of local identifiers`, declaration);
  }
  if (declaration.async || declaration.generator ||
      declaration.params.some(param => !ast.isIdentifier(param))) {
    fail(entry, ` '${declaration.id.name}' needs plain positional parameters`, declaration);
  }
  if (body.slice(0, -1).some(item =>
    !ast.isVariableDeclaration(item) && !ast.isExpressionStatement(item))) {
    fail(entry, ` '${declaration.id.name}' needs top-level declarations and hook calls`, declaration);
  }
  const resultNames = (last.argument as t.ArrayExpression).elements.map(element =>
    (element as t.Identifier).name);
  if (new Set(resultNames).size !== resultNames.length) {
    fail(entry, ` '${declaration.id.name}' cannot return the same binding twice`, last);
  }
  for (const element of last.argument.elements) {
    const binding = analysis.nodeToScope.get(element as BaseNode)?.getBinding((element as t.Identifier).name);
    if (binding === undefined || binding.scope.block !== declaration || binding.kind === 'param') {
      fail(entry, ` '${declaration.id.name}' must return its own top-level bindings`, element as BaseNode);
    }
  }
  return { entry, exportStatement: statement, declaration, reactImports, resultNames };
}

function uniqueName(occupied: Set<string>, label: string): string {
  let index = 0;
  let name: string;
  do { name = `__mmdHook${index++}_${label}`; } while (occupied.has(name));
  occupied.add(name);
  return name;
}

function rename(binding: Binding, name: string): void {
  binding.identifier.name = name;
  for (const reference of binding.references) reference.name = name;
}

function expand(use: HookUse, occupied: Set<string>): {
  statements: t.Statement[]; imports: t.ImportDeclaration[];
} {
  const { template, call, resultNames } = use;
  const fn = copy(template.declaration);
  const analysis = analyzeScope(fn);
  const fnScope = analysis.nodeToScope.get(fn)!;
  const last = fn.body.body.at(-1) as t.ReturnStatement;
  const outputs = (last.argument as t.ArrayExpression).elements as t.Identifier[];
  const outputBindings = new Map<Binding, string>();
  outputs.forEach((identifier, index) => {
    outputBindings.set(analysis.nodeToScope.get(identifier)!.getBinding(identifier.name)!, resultNames[index]!);
  });

  const aliases = new Map<string, string>();
  const imports: t.ImportDeclaration[] = [];
  for (const [local, imported] of template.reactImports) {
    const alias = uniqueName(occupied, imported);
    aliases.set(local, alias);
    imports.push(ast.importDeclaration([
      ast.importSpecifier(ast.identifier(alias), ast.identifier(imported)),
    ], ast.stringLiteral('react')));
  }
  walkAst(fn.body as BaseNode, { enter(node, parent, key) {
    if (!ast.isIdentifier(node) || !isReferenceIdentifier(parent, key)) return;
    const alias = aliases.get(node.name);
    if (alias !== undefined && analysis.nodeToScope.get(node)?.getBinding(node.name) === undefined) {
      node.name = alias;
    }
  } });

  const bindings: Binding[] = [];
  function collect(scope: typeof fnScope): void {
    bindings.push(...scope.bindings.values());
    for (const child of scope.children) collect(child);
  }
  collect(fnScope);
  for (const binding of bindings) {
    rename(binding, outputBindings.get(binding) ?? uniqueName(occupied, binding.name));
  }
  const parameters = fn.params as t.Identifier[];
  const argumentsBeforeBody = parameters.map((param, index) =>
    ast.variableDeclaration('const', [
      ast.variableDeclarator(ast.identifier(param.name), copy(call.arguments[index] as t.Expression)),
    ]));
  return { statements: [...argumentsBeforeBody, ...fn.body.body.slice(0, -1)], imports };
}

/** Mutates the linker-owned ASTs before discovery, analysis, and final emission. */
export function specializeLinkedReactHooks(
  entries: Map<string, ModuleEntry>, options: CompileModulesOptions,
): void {
  const packages = options.react?.packages ?? [];
  if (packages.length === 0) return;
  const templates = new Map<string, HookTemplate>();
  for (const entry of entries.values()) {
    if (!isReactPackageModule(entry.id, packages)) continue;
    const analysis = analyzeScope(entry.ast);
    for (const statement of entry.ast.body) {
      if (!ast.isExportNamedDeclaration(statement) ||
          !ast.isFunctionDeclaration(statement.declaration) ||
          statement.declaration.id == null) continue;
      const template = templateFor(entry, statement, statement.declaration, analysis);
      if (template !== null) {
        const name = template.declaration.id!.name;
        const references = analysis.rootScope.bindings.get(name)?.references ?? [];
        if (references.length > 0) {
          fail(entry, ` '${name}' has a local call; local specialization is not implemented`, references[0]!);
        }
        templates.set(`${entry.id}#${name}`, template);
      }
    }
  }
  if (templates.size === 0) return;

  const usesByEntry = new Map<ModuleEntry, HookUse[]>();
  for (const entry of entries.values()) {
    const analysis = analyzeScope(entry.ast);
    for (const statement of entry.ast.body) {
      if ((ast.isExportNamedDeclaration(statement) || statement.type === 'ExportAllDeclaration') &&
          statement.source != null && ast.isStringLiteral(statement.source)) {
        const target = resolveModule(entry.id, String(statement.source.value), entries, options);
        if (target !== undefined && [...templates.keys()].some(key => key.startsWith(`${target.id}#`))) {
          if (statement.type === 'ExportAllDeclaration' || statement.specifiers.some(specifier =>
              ast.isExportSpecifier(specifier) && ast.isIdentifier(specifier.local) &&
              templates.has(`${target.id}#${specifier.local.name}`))) {
            fail(entry, ` re-export needs a linked hook template`, statement);
          }
        }
      }
      if (!ast.isImportDeclaration(statement) || !ast.isStringLiteral(statement.source)) continue;
      const target = resolveModule(entry.id, String(statement.source.value), entries, options);
      if (target === undefined) continue;
      for (const specifier of statement.specifiers) {
        if (specifier.type === 'ImportNamespaceSpecifier' &&
            [...templates.keys()].some(key => key.startsWith(`${target.id}#`)) &&
            (analysis.rootScope.bindings.get(specifier.local.name)?.references.length ?? 0) > 0) {
          fail(entry, ` namespace access to a custom hook is not specialized`, specifier);
        }
        if (!ast.isImportSpecifier(specifier) || !ast.isIdentifier(specifier.imported)) continue;
        const template = templates.get(`${target.id}#${specifier.imported.name}`);
        if (template === undefined) continue;
        const binding = analysis.rootScope.bindings.get(specifier.local.name);
        if (binding === undefined) continue;
        if (binding.constantViolations.length > 0) {
          fail(entry, ` '${specifier.local.name}' cannot be reassigned`, binding.constantViolations[0]!);
        }
        if (!isReactPackageModule(entry.id, packages) && binding.references.length > 0) {
          fail(entry, ` '${specifier.local.name}' needs a caller in an opted-in React package`, binding.references[0]!);
        }
        for (const reference of binding.references) {
          const call = analysis.parentByNode.get(reference);
          if (!ast.isCallExpression(call) || call.callee !== reference || call.optional) {
            fail(entry, ` '${specifier.local.name}' needs a direct call`, reference);
          }
          const declarator = analysis.parentByNode.get(call);
          const declaration = declarator && analysis.parentByNode.get(declarator);
          const owner = componentOwner(analysis, call);
          if (owner === null || !ast.isVariableDeclarator(declarator) ||
              declarator.init !== call || !ast.isVariableDeclaration(declaration) ||
              declaration.declarations.length !== 1 ||
              analysis.parentByNode.get(declaration) !== owner.body ||
              !ast.isArrayPattern(declarator.id) ||
              declarator.id.elements.length !== template.resultNames.length ||
              declarator.id.elements.some(element => !ast.isIdentifier(element)) ||
              call.arguments.length !== template.declaration.params.length ||
              call.arguments.some(argument => !ast.isExpression(argument))) {
            fail(entry, ` '${specifier.local.name}' needs a direct top-level tuple declaration in a component`, reference);
          }
          const resultNames = declarator.id.elements.map(element => (element as t.Identifier).name);
          const uses = usesByEntry.get(entry) ?? [];
          uses.push({ template, importStatement: statement, importSpecifier: specifier,
            statement: declaration, call, resultNames });
          usesByEntry.set(entry, uses);
        }
      }
    }
  }

  for (const [entry, uses] of usesByEntry) {
    const occupied = new Set<string>();
    walkAst(entry.ast as BaseNode, { enter(node) { if (ast.isIdentifier(node)) occupied.add(node.name); } });
    const replacements = new Map<t.VariableDeclaration, t.Statement[]>();
    const imports: t.ImportDeclaration[] = [];
    for (const use of uses) {
      const expanded = expand(use, occupied);
      replacements.set(use.statement, expanded.statements);
      imports.push(...expanded.imports);
      use.importStatement.specifiers = use.importStatement.specifiers.filter(
        specifier => specifier !== use.importSpecifier);
    }
    walkAst(entry.ast as BaseNode, { enter(node) {
      if (!ast.isFunctionDeclaration(node)) return;
      node.body.body = node.body.body.flatMap(statement =>
        ast.isVariableDeclaration(statement) ? replacements.get(statement) ?? [statement] : [statement]);
    } });
    // An emptied import still evaluates the source module. Its other exports
    // and top-level effects retain their normal ESM identity and order.
    entry.ast.body = [...imports, ...entry.ast.body];
  }
  for (const template of templates.values()) {
    template.entry.ast.body = template.entry.ast.body.filter(
      statement => statement !== template.exportStatement);
  }
}
