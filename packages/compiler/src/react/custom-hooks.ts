/**
 * Specialize React hooks while the source graph is still available.
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
import { isStablePrimitiveBinding } from '../linking/stable-values';

type HookFunction = t.FunctionDeclaration |
  (t.ArrowFunctionExpression & { body: t.BlockStatement }) |
  (t.FunctionExpression & { body: t.BlockStatement });

interface HookTemplate {
  entry: ModuleEntry;
  statement: t.Statement;
  exported: boolean;
  name: string;
  declaration: HookFunction;
  reactImports: Map<string, string>;
  captureNames: string[];
  captureExports: Map<string, string>;
  resultNames: string[];
}

interface HookUse {
  template: HookTemplate;
  importStatement?: t.ImportDeclaration;
  importSpecifier?: t.ImportSpecifier;
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
  entry: ModuleEntry, statement: t.Statement, exported: boolean,
  declaration: HookFunction, name: string,
  analysis: ReturnType<typeof analyzeScope>,
): HookTemplate | null {
  if (!/^use[A-Z]/.test(name)) return null;
  const reactImports = new Map<string, string>();
  const captureNames = new Set<string>();
  let hasReactUse = false;
  walkAst(declaration.body as BaseNode, { enter(node, parent, key) {
    if (!ast.isIdentifier(node) || !isReferenceIdentifier(parent, key)) return;
    const binding = analysis.nodeToScope.get(node)?.getBinding(node.name);
    if (binding?.kind === 'import' && ast.isImportDeclaration(binding.declarationNode) &&
        binding.declarationNode.source.value === 'react') hasReactUse = true;
  } });
  if (!hasReactUse) return null;
  walkAst(declaration.body as BaseNode, { enter(node, parent, key) {
    if (node.type === 'ThisExpression' || node.type === 'Super' || node.type === 'MetaProperty' ||
        ast.isIdentifier(node) && node.name === 'arguments' && isReferenceIdentifier(parent, key)) {
      fail(entry, ` '${name}' uses function context that cannot move into a component`, node);
    }
    if (!ast.isIdentifier(node) || !isReferenceIdentifier(parent, key)) return;
    const binding = analysis.nodeToScope.get(node)?.getBinding(node.name);
    if (binding?.scope.isProgramScope !== true) return;
    if (binding.kind !== 'import' || !ast.isImportDeclaration(binding.declarationNode) ||
        binding.declarationNode.source.value !== 'react') {
      if (node.name === name || /^use[A-Z]/.test(node.name) &&
          ast.isCallExpression(parent) && parent.callee === node) {
        fail(entry, ` '${name}' calls another custom hook; hook composition is not specialized`, node);
      }
      if (!isStablePrimitiveBinding(binding, node.name)) {
        fail(entry, ` '${name}' capture '${node.name}' needs a stable primitive const`, node);
      }
      captureNames.add(node.name);
      return;
    }
    const specifier = binding.declarationNode.specifiers.find(item => item.local.name === node.name);
    if (!ast.isImportSpecifier(specifier) || !ast.isIdentifier(specifier.imported)) {
      fail(entry, ` '${name}' requires a named React API import`, node);
    }
    if (!ast.isCallExpression(parent) || parent.callee !== node || parent.optional) {
      fail(entry, ` '${name}' uses '${node.name}' outside a direct call`, node);
    }
    reactImports.set(node.name, specifier.imported.name);
  } });
  const body = declaration.body.body;
  const last = body.at(-1);
  if (!ast.isReturnStatement(last) || !ast.isArrayExpression(last.argument) ||
      last.argument.elements.length === 0 ||
      last.argument.elements.some(element => !ast.isIdentifier(element))) {
    fail(entry, ` '${name}' must return a fixed tuple of local identifiers`, declaration);
  }
  if (declaration.async || declaration.type !== 'ArrowFunctionExpression' && declaration.generator ||
      declaration.type === 'FunctionExpression' && declaration.id !== null ||
      declaration.params.some(param => !ast.isIdentifier(param))) {
    fail(entry, ` '${name}' needs plain positional parameters`, declaration);
  }
  if (body.slice(0, -1).some(item =>
    !ast.isVariableDeclaration(item) && !ast.isExpressionStatement(item))) {
    fail(entry, ` '${name}' needs top-level declarations and hook calls`, declaration);
  }
  const resultNames = (last.argument as t.ArrayExpression).elements.map(element =>
    (element as t.Identifier).name);
  if (new Set(resultNames).size !== resultNames.length) {
    fail(entry, ` '${name}' cannot return the same binding twice`, last);
  }
  for (const element of last.argument.elements) {
    const binding = analysis.nodeToScope.get(element as BaseNode)?.getBinding((element as t.Identifier).name);
    if (binding === undefined || binding.scope.block !== declaration || binding.kind === 'param') {
      fail(entry, ` '${name}' must return its own top-level bindings`, element as BaseNode);
    }
  }
  return { entry, statement, exported, name, declaration, reactImports,
    captureNames: [...captureNames], captureExports: new Map(), resultNames };
}

function recordUse(
  entry: ModuleEntry,
  analysis: ReturnType<typeof analyzeScope>,
  template: HookTemplate,
  reference: t.Identifier,
  usesByEntry: Map<ModuleEntry, HookUse[]>,
  importStatement?: t.ImportDeclaration,
  importSpecifier?: t.ImportSpecifier,
): void {
  const call = analysis.parentByNode.get(reference);
  if (!ast.isCallExpression(call) || call.callee !== reference || call.optional) {
    fail(entry, ` '${reference.name}' needs a direct call`, reference);
  }
  const declarator = analysis.parentByNode.get(call);
  const declaration = declarator && analysis.parentByNode.get(declarator);
  const owner = componentOwner(analysis, call);
  if (template.entry === entry) {
    for (const name of template.captureNames) {
      if (analysis.nodeToScope.get(call)?.getBinding(name)?.scope.isProgramScope !== true) {
        fail(entry, ` '${template.name}' capture '${name}' is shadowed at this call`, call);
      }
    }
  }
  if (owner === null || !ast.isVariableDeclarator(declarator) ||
      declarator.init !== call || !ast.isVariableDeclaration(declaration) ||
      declaration.declarations.length !== 1 ||
      analysis.parentByNode.get(declaration) !== owner.body ||
      !ast.isArrayPattern(declarator.id) ||
      declarator.id.elements.length !== template.resultNames.length ||
      declarator.id.elements.some(element => !ast.isIdentifier(element)) ||
      call.arguments.length !== template.declaration.params.length ||
      call.arguments.some(argument => !ast.isExpression(argument))) {
    fail(entry, ` '${reference.name}' needs a direct top-level tuple declaration in a component`, reference);
  }
  const resultNames = declarator.id.elements.map(element => (element as t.Identifier).name);
  const uses = usesByEntry.get(entry) ?? [];
  uses.push({ template, importStatement, importSpecifier,
    statement: declaration, call, resultNames });
  usesByEntry.set(entry, uses);
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
    const declaration = ast.importDeclaration([
      ast.importSpecifier(ast.identifier(alias), ast.identifier(imported)),
    ], ast.stringLiteral('react'));
    (declaration as t.ImportDeclaration & { __mmdLinkedHookImport: boolean }).__mmdLinkedHookImport = true;
    imports.push(declaration);
  }
  if (use.importStatement !== undefined) {
    for (const [local, exported] of template.captureExports) {
      const alias = uniqueName(occupied, `capture_${local}`);
      aliases.set(local, alias);
      use.importStatement.specifiers.push(ast.importSpecifier(
        ast.identifier(alias), ast.identifier(exported)));
    }
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
      const exported = ast.isExportNamedDeclaration(statement);
      const declaration = exported ? statement.declaration : statement;
      let fn: HookFunction;
      let name: string;
      if (ast.isFunctionDeclaration(declaration) && declaration.id !== null) {
        fn = declaration;
        name = declaration.id.name;
      } else if (ast.isVariableDeclaration(declaration) && declaration.declarations.length === 1 &&
          ast.isIdentifier(declaration.declarations[0]!.id) &&
          (ast.isArrowFunctionExpression(declaration.declarations[0]!.init) ||
            ast.isFunctionExpression(declaration.declarations[0]!.init)) &&
          ast.isBlockStatement(declaration.declarations[0]!.init.body)) {
        fn = declaration.declarations[0]!.init as HookFunction;
        name = (declaration.declarations[0]!.id as t.Identifier).name;
      } else continue;
      const template = templateFor(entry, statement, exported, fn, name, analysis);
      if (template !== null) templates.set(`${entry.id}#${name}`, template);
    }
  }
  if (templates.size === 0) return;

  const occupiedExports = new Set<string>();
  for (const entry of entries.values()) {
    walkAst(entry.ast as BaseNode, { enter(node) {
      if (ast.isIdentifier(node)) occupiedExports.add(node.name);
    } });
  }
  const captureExports = new Map<string, string>();
  for (const template of templates.values()) {
    for (const name of template.captureNames) {
      const key = `${template.entry.id}#${name}`;
      let exported = captureExports.get(key);
      if (exported === undefined) {
        exported = uniqueName(occupiedExports, `capture_${name}`);
        captureExports.set(key, exported);
      }
      template.captureExports.set(name, exported);
    }
  }

  function resolveTemplate(
    entry: ModuleEntry, exportedName: string, visited = new Set<string>(),
  ): HookTemplate | undefined {
    const key = `${entry.id}#${exportedName}`;
    if (visited.has(key)) return undefined;
    visited.add(key);
    const direct = templates.get(key);
    if (direct?.exported === true) return direct;
    for (const statement of entry.ast.body) {
      if (!ast.isExportNamedDeclaration(statement)) continue;
      for (const specifier of statement.specifiers) {
        if (!ast.isExportSpecifier(specifier) || !ast.isIdentifier(specifier.exported) ||
            specifier.exported.name !== exportedName || !ast.isIdentifier(specifier.local)) continue;
        if (statement.source != null && ast.isStringLiteral(statement.source)) {
          const target = resolveModule(entry.id, String(statement.source.value), entries, options);
          if (target !== undefined) {
            const resolved = resolveTemplate(target, specifier.local.name, visited);
            if (resolved !== undefined) return resolved;
          }
        }
      }
    }
    return undefined;
  }

  function hasHookExports(entry: ModuleEntry): boolean {
    if ([...templates.values()].some(template => template.entry === entry && template.exported)) return true;
    return entry.ast.body.some(statement => {
      if (!ast.isExportNamedDeclaration(statement) || statement.source == null ||
          !ast.isStringLiteral(statement.source)) return false;
      const target = resolveModule(entry.id, String(statement.source.value), entries, options);
      return target !== undefined && statement.specifiers.some(specifier =>
        ast.isExportSpecifier(specifier) && ast.isIdentifier(specifier.local) &&
        resolveTemplate(target, specifier.local.name) !== undefined);
    });
  }

  const usesByEntry = new Map<ModuleEntry, HookUse[]>();
  for (const entry of entries.values()) {
    const analysis = analyzeScope(entry.ast);
    for (const template of templates.values()) {
      if (template.entry !== entry) continue;
      const name = template.name;
      const binding = analysis.rootScope.bindings.get(name);
      if (binding === undefined) continue;
      if (binding.constantViolations.length > 0) {
        fail(entry, ` '${name}' cannot be reassigned`, binding.constantViolations[0]!);
      }
      for (const reference of binding.references) {
        recordUse(entry, analysis, template, reference, usesByEntry);
      }
    }
    for (const statement of entry.ast.body) {
      if ((ast.isExportNamedDeclaration(statement) || statement.type === 'ExportAllDeclaration') &&
          statement.source != null && ast.isStringLiteral(statement.source)) {
        const target = resolveModule(entry.id, String(statement.source.value), entries, options);
        if (statement.type === 'ExportAllDeclaration' && target !== undefined &&
            hasHookExports(target)) {
          fail(entry, ` wildcard re-export of a custom hook is not specialized`, statement);
        }
      }
      if (!ast.isImportDeclaration(statement) || !ast.isStringLiteral(statement.source)) continue;
      const target = resolveModule(entry.id, String(statement.source.value), entries, options);
      if (target === undefined) continue;
      for (const specifier of statement.specifiers) {
        if (specifier.type === 'ImportNamespaceSpecifier' &&
            hasHookExports(target) &&
            (analysis.rootScope.bindings.get(specifier.local.name)?.references.length ?? 0) > 0) {
          fail(entry, ` namespace access to a custom hook is not specialized`, specifier);
        }
        if (!ast.isImportSpecifier(specifier) || !ast.isIdentifier(specifier.imported)) continue;
        const template = resolveTemplate(target, specifier.imported.name);
        if (template === undefined) continue;
        const binding = analysis.rootScope.bindings.get(specifier.local.name);
        if (binding === undefined) continue;
        if (binding.constantViolations.length > 0) {
          fail(entry, ` '${specifier.local.name}' cannot be reassigned`, binding.constantViolations[0]!);
        }
        for (const reference of binding.references) {
          recordUse(entry, analysis, template, reference, usesByEntry, statement, specifier);
        }
      }
    }
  }

  const reexportReplacements = new Map<ModuleEntry, Map<t.Statement, t.Statement>>();
  for (const entry of entries.values()) {
    for (const statement of entry.ast.body) {
      if (!ast.isExportNamedDeclaration(statement) || statement.source == null ||
          !ast.isStringLiteral(statement.source)) continue;
      const target = resolveModule(entry.id, String(statement.source.value), entries, options);
      if (target === undefined) continue;
      const forwardedCaptures = new Set<string>();
      for (const specifier of statement.specifiers) {
        if (!ast.isExportSpecifier(specifier) || !ast.isIdentifier(specifier.local)) continue;
        const template = resolveTemplate(target, specifier.local.name);
        if (template === undefined) continue;
        for (const exported of template.captureExports.values()) forwardedCaptures.add(exported);
      }
      const remaining = statement.specifiers.filter(specifier =>
        !ast.isExportSpecifier(specifier) || !ast.isIdentifier(specifier.local) ||
        resolveTemplate(target, specifier.local.name) === undefined);
      if (remaining.length === statement.specifiers.length) continue;
      const specifiers = [...remaining, ...[...forwardedCaptures].map(exported =>
        ast.exportSpecifier(ast.identifier(exported), ast.identifier(exported)))];
      const replacement = specifiers.length === 0
        ? ast.importDeclaration([], copy(statement.source))
        : { ...statement, specifiers };
      const replacements = reexportReplacements.get(entry) ?? new Map<t.Statement, t.Statement>();
      replacements.set(statement, replacement);
      reexportReplacements.set(entry, replacements);
    }
  }
  for (const [entry, replacements] of reexportReplacements) {
    entry.ast.body = entry.ast.body.map(statement => replacements.get(statement) ?? statement);
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
      if (use.importStatement !== undefined) {
        use.importStatement.specifiers = use.importStatement.specifiers.filter(
          specifier => specifier !== use.importSpecifier);
      }
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
      statement => statement !== template.statement);
  }
  const sourceExports = new Map<ModuleEntry, Map<string, string>>();
  for (const template of templates.values()) {
    if (!template.exported) continue;
    const captures = sourceExports.get(template.entry) ?? new Map<string, string>();
    for (const [local, exported] of template.captureExports) captures.set(local, exported);
    sourceExports.set(template.entry, captures);
  }
  for (const [entry, captures] of sourceExports) {
    if (captures.size === 0) continue;
    entry.ast.body.push(ast.exportNamedDeclaration(null, [...captures].map(([local, exported]) =>
      ast.exportSpecifier(ast.identifier(local), ast.identifier(exported)))));
  }
}
