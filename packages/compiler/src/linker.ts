/**
 * Two-pass module linker for canonical cross-file state identity.
 *
 * Pass 1 discovers exported state and function summaries. Subsequent passes
 * resolve import aliases and propagate summaries through re-exports/calls.
 * The final compile receives binding metadata, while emitted ES imports remain
 * untouched for the host bundler.
 */
import { posix } from 'node:path';
import {
  parseSync,
  transformFromAstSync,
  type PluginObject,
  type PluginTarget,
} from '@babel/core';
import syntaxJsx from '@babel/plugin-syntax-jsx';
import transformTypescript from '@babel/plugin-transform-typescript';
import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import { cloneNode as cloneEstreeNode } from './ast';
import {
  ESTREE_VISITOR_KEYS,
  walkAst,
  type BaseNode,
} from './ast';
import { buildAccessTable, runAnalysis } from './analysis';
import {
  compileAst,
  compileAstDetailed,
  type CompilerSourceMap,
} from './compile';
import {
  linkComponentGraph,
  type ComponentGraphNode,
} from './component-linker';
import {
  analyzedComponentDeclarations,
  analyzedComponentExport,
  discoverComponentExports,
  type ComponentExportInfo,
} from './components/manifest';
import { summarizeHelper } from './helper-summaries';
import {
  moduleFunctionStringCandidates,
  moduleStateStringCandidates,
} from './analysis/type-candidates';
import { analyzeRouterJsx } from './router';
import {
  canonicalStateKey,
  createCtx,
  isConstObjectState,
  isStoreObject,
  nodeHasJsx,
  unwrapTypeExpression,
  type InternalMemoDomOptions,
  type LinkedImport,
  type LinkedDynamicComponentCandidate,
  type LinkedComponentRowUse,
  type MemoDomOptions,
  type ParameterWrite,
  type StateKind,
} from './context';
import { DEFAULT_TRANSPARENT_ASYNC_SOURCES } from './context/model';
import { isRenderPropReference } from './components/children';
import { installLinkedDynamicComponentImports } from './jsx/dynamic-tags';
import { normalizeComponentDeclarations } from './components/declarations';
import { initializeGeneratedIdentifiers } from './identifiers';
import {
  lowerTransparentGroups,
  scanAndLowerModuleSourceDeclarations,
  scanTransparentSourceImports,
} from './data-sources';
import {
  collectCompilerRoutes,
  validateCompilerRouteGraph,
} from './router';

export interface CompileModulesOptions
  extends Omit<
    MemoDomOptions,
    | 'moduleId'
    | 'linkedImports'
    | 'linkedComponentPaths'
    | 'linkedComponentRows'
    | 'linkedComponentPropSources'
    | 'linkedComponentRenderProps'
  > {
  /**
   * Bundler-style import aliases. Prefixes match on a segment boundary, so
   * `{ '@': './src' }` resolves both `@/state` and `@/features/todos`.
   */
  aliases?: Readonly<Record<string, string>>;
  /**
   * Optional host resolver. Return a module id present in `modules`, or
   * undefined to continue with aliases and normal relative resolution.
   */
  resolveImport?: (specifier: string, importer: string) => string | undefined;
  /**
   * Preserve imported state/component identity but replace imported function
   * summaries with an unbounded effect. This is an evaluation ablation for
   * measuring the contribution of cross-module effect-summary propagation.
   * Defaults to true.
   */
  linkFunctionSummaries?: boolean;
}

export interface CompiledComponentExport {
  exported: string;
  local: string;
  listLightweight: boolean;
}

export interface CompiledStateExport {
  exported: string;
  kind: StateKind;
  key: string;
}

export interface CompiledFunctionExport {
  exported: string;
  reads: string[];
  writes: string[];
  boundedWrites: string[];
  parameterWrites: ParameterWrite[];
  unbounded: boolean;
}

export interface CompiledModuleMetadata {
  componentExports: CompiledComponentExport[];
  /** Canonical state identities exposed for evaluation and tooling. */
  stateExports: CompiledStateExport[];
  /** Fixed-point function summaries exposed for evaluation and tooling. */
  functionExports: CompiledFunctionExport[];
  /** Canonical read key -> statically selected runtime entity patterns. */
  readers: Record<string, string[]>;
}

export interface CompiledApplicationRoot {
  key: string;
  moduleId: string;
  mountModuleId: string;
  local: string;
  rootId: string;
}

export interface CompiledModules {
  output: Record<string, string>;
  maps: Record<string, CompilerSourceMap>;
  metadata: Record<string, CompiledModuleMetadata>;
  applicationRoot?: CompiledApplicationRoot;
}

interface StateExport {
  type: 'state';
  kind: StateKind;
  key: string;
  transparentSource?: boolean;
  tagCandidates: string[];
  componentCandidates: string[];
}

interface FunctionExport {
  type: 'function';
  tagCandidates: string[];
  componentCandidates: string[];
  reads: string[];
  writes: string[];
  boundedWrites: string[];
  parameterWrites: ParameterWrite[];
  unbounded: boolean;
}

interface ComponentExport extends ComponentExportInfo {
  type: 'component';
}

interface ValueExport {
  type: 'value';
}

type LinkedExport = StateExport | FunctionExport | ComponentExport | ValueExport;

interface ImportRef {
  local: string;
  imported: string;
  source: string;
}

interface ModuleManifest {
  exports: Record<string, LinkedExport>;
  imports: ImportRef[];
  mounts: string[];
  components: ComponentGraphNode[];
  componentUsages: ComponentPropUsage[];
  readers: Record<string, string[]>;
}

interface ComponentPropUsage {
  target: string;
  prop: string;
  kind: 'jsx' | 'scalar';
}

interface RenderUsage {
  jsx: Set<string>;
  scalar: Set<string>;
}

interface ModuleEntry {
  originalId: string;
  id: string;
  source: string;
  ast: t.File;
}

function canonicalModuleId(raw: string): string {
  const slashed = raw.replace(/\\/g, '/');
  const normalized = posix.normalize(slashed);
  // posix.normalize removes a leading "./"; preserve it when the caller used
  // a project-relative id. Bare ids and aliases (`@/x`, `virtual:x`) must not
  // be rewritten as relative paths.
  if (slashed.startsWith('./') && !normalized.startsWith('../')) {
    return `./${normalized}`;
  }
  return normalized;
}

function parseModule(id: string, source: string): t.File {
  const ast = parseSync(source, {
    filename: id,
    sourceType: 'module',
    parserOpts: {
      plugins: ['typescript', 'jsx'],
    },
    configFile: false,
    babelrc: false,
  });
  if (ast === null) {
    throw new Error(`memo-dom: failed to parse module '${id}'`);
  }
  return ast as unknown as t.File;
}

function compilerOptions(
  options: CompileModulesOptions,
  rootId = 'App',
): InternalMemoDomOptions {
  return {
    ...(options.runtimePath === undefined ? {} : { runtimePath: options.runtimePath }),
    ...(options.dataRuntimePath === undefined ? {} : { dataRuntimePath: options.dataRuntimePath }),
    ...(options.transparentAsyncSources === undefined
      ? {}
      : { transparentAsyncSources: options.transparentAsyncSources }),
    ...(options.hot === undefined ? {} : { hot: options.hot }),
    ...(options.moduleStateCells === undefined ? {} : { moduleStateCells: options.moduleStateCells }),
    rootId,
  };
}

function analyzedComponentUsages(ctx: ReturnType<typeof createCtx>): ComponentPropUsage[] {
  const usages = new Map<string, ComponentPropUsage>();
  const record = (
    target: string,
    prop: string,
    kind: ComponentPropUsage['kind'],
  ): void => {
    usages.set(`${target}\0${prop}\0${kind}`, { target, prop, kind });
  };

  for (const [owner, componentPath] of ctx.compPaths) {
    walkAst<BaseNode>(componentPath.node as unknown as BaseNode, {
      enter(node) {
        if (node.type !== 'JSXElement') return;
        const element = node as unknown as t.JSXElement;
        const opening = element.openingElement;
        const tag = opening.name;
        if (!astFactory.isJSXIdentifier(tag) || !/^[A-Z]/.test(tag.name)) return;
        const target =
          ctx.importedComponents.get(tag.name)?.key ??
          (ctx.comps.has(tag.name) ? `${ctx.moduleId}#${tag.name}` : null);
        if (target === null) return;

        for (const attribute of opening.attributes) {
          if (!astFactory.isJSXAttribute(attribute)) continue;
          const name = astFactory.isJSXIdentifier(attribute.name)
            ? attribute.name.name
            : attribute.name.name.name;
          const value = attribute.value;
          if (
            astFactory.isJSXElement(value) ||
            astFactory.isJSXFragment(value) ||
            (astFactory.isJSXExpressionContainer(value) &&
              astFactory.isExpression(value.expression) &&
              (nodeHasJsx(value.expression) ||
                isRenderPropReference(ctx, owner, value.expression)))
          ) {
            record(target, name, 'jsx');
          } else {
            record(target, name, 'scalar');
          }
        }
        if (
          element.children.some(
            (child) => !astFactory.isJSXText(child) || child.value.trim() !== '',
          )
        ) {
          record(target, 'children', 'jsx');
        }
      },
    });
  }
  return [...usages.values()].sort(
    (a, b) =>
      a.target.localeCompare(b.target) ||
      a.prop.localeCompare(b.prop) ||
      a.kind.localeCompare(b.kind),
  );
}

function componentCandidateKeys(
  ctx: ReturnType<typeof createCtx>,
  names: readonly string[],
): string[] {
  return [
    ...new Set(
      names.flatMap((name) => {
        const imported = ctx.importedComponents.get(name);
        if (imported !== undefined) return [imported.key];
        return ctx.comps.has(name) ? [`${ctx.moduleId}#${name}`] : [];
      }),
    ),
  ].sort();
}

function directComponentNames(
  expression: t.Expression,
  componentNames: ReadonlySet<string>,
  output: Set<string>,
): void {
  let current: t.Node = expression;
  while (
    astFactory.isTSAsExpression(current) ||
    astFactory.isTSTypeAssertion(current) ||
    astFactory.isTSNonNullExpression(current)
  ) {
    current = current.expression;
  }
  expression = current as t.Expression;
  if (astFactory.isIdentifier(expression)) {
    if (componentNames.has(expression.name)) output.add(expression.name);
    return;
  }
  if (astFactory.isConditionalExpression(expression)) {
    directComponentNames(expression.consequent, componentNames, output);
    directComponentNames(expression.alternate, componentNames, output);
    return;
  }
  if (astFactory.isLogicalExpression(expression)) {
    directComponentNames(expression.right, componentNames, output);
    return;
  }
  if (astFactory.isObjectExpression(expression)) {
    for (const property of expression.properties) {
      if (astFactory.isObjectProperty(property) && astFactory.isExpression(property.value)) {
        directComponentNames(property.value, componentNames, output);
      }
    }
    return;
  }
  if (astFactory.isArrayExpression(expression)) {
    for (const element of expression.elements) {
      if (element != null && !astFactory.isSpreadElement(element)) {
        directComponentNames(element, componentNames, output);
      }
    }
  }
}

function directFunctionComponentNames(
  fn:
    | t.FunctionDeclaration
    | t.FunctionExpression
    | t.ArrowFunctionExpression,
  componentNames: ReadonlySet<string>,
): string[] {
  const output = new Set<string>();
  if (astFactory.isExpression(fn.body)) {
    directComponentNames(fn.body, componentNames, output);
    return [...output];
  }
  const visit = (node: t.Node): void => {
    if (astFactory.isFunction(node)) return;
    if (astFactory.isReturnStatement(node)) {
      if (astFactory.isExpression(node.argument)) {
        directComponentNames(node.argument, componentNames, output);
      }
      return;
    }
    for (const key of ESTREE_VISITOR_KEYS[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const entry of child) {
          if (entry != null && typeof entry === 'object' && 'type' in entry) {
            visit(entry as t.Node);
          }
        }
      } else if (
        child != null &&
        typeof child === 'object' &&
        'type' in child
      ) {
        visit(child as t.Node);
      }
    }
  };
  for (const statement of fn.body.body) visit(statement);
  return [...output];
}

function importRefs(program: t.Program): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const stmt of program.body) {
    if (!astFactory.isImportDeclaration(stmt) || stmt.importKind === 'type') continue;
    for (const spec of stmt.specifiers) {
      if (astFactory.isImportSpecifier(spec)) {
        if (spec.importKind === 'type') continue;
        const imported = astFactory.isIdentifier(spec.imported)
          ? spec.imported.name
          : spec.imported.value;
        refs.push({ local: spec.local.name, imported, source: stmt.source.value });
      } else if (astFactory.isImportDefaultSpecifier(spec)) {
        refs.push({ local: spec.local.name, imported: 'default', source: stmt.source.value });
      } else {
        refs.push({ local: spec.local.name, imported: '*', source: stmt.source.value });
      }
    }
  }
  return refs;
}

function applicationMounts(
  program: t.Program,
  runtimePath: string,
): string[] {
  const mountBindings = new Set<string>();
  for (const statement of program.body) {
    if (
      !astFactory.isImportDeclaration(statement) ||
      statement.source.value !== runtimePath
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (
        astFactory.isImportSpecifier(specifier) &&
        (astFactory.isIdentifier(specifier.imported, { name: 'mount' }) ||
          astFactory.isStringLiteral(specifier.imported, { value: 'mount' }))
      ) {
        mountBindings.add(specifier.local.name);
      }
    }
  }

  const mounted: string[] = [];
  for (const statement of program.body) {
    if (!astFactory.isExpressionStatement(statement)) continue;
    const expression = statement.expression;
    if (
      !astFactory.isCallExpression(expression) ||
      !astFactory.isIdentifier(expression.callee) ||
      !mountBindings.has(expression.callee.name)
    ) {
      continue;
    }
    const component = expression.arguments[1];
    if (component === undefined || !astFactory.isIdentifier(component)) {
      throw new Error(
        'memo-dom: mount() must receive a statically imported component identifier',
      );
    }
    mounted.push(component.name);
  }
  return mounted;
}

function exportedLocals(program: t.Program): Map<string, string> {
  const out = new Map<string, string>();
  for (const stmt of program.body) {
    if (astFactory.isExportDefaultDeclaration(stmt)) {
      if (
        (astFactory.isFunctionDeclaration(stmt.declaration) ||
          astFactory.isClassDeclaration(stmt.declaration)) &&
        stmt.declaration.id != null
      ) {
        out.set('default', stmt.declaration.id.name);
      } else if (astFactory.isIdentifier(stmt.declaration)) {
        out.set('default', stmt.declaration.name);
      }
      continue;
    }
    if (!astFactory.isExportNamedDeclaration(stmt)) continue;
    if (stmt.source !== null) {
      throw new Error(
        `memo-dom: re-export-from declarations are not supported by compileModules(); import then export the binding explicitly`,
      );
    }
    const decl = stmt.declaration;
    if (astFactory.isVariableDeclaration(decl)) {
      for (const item of decl.declarations) {
        if (astFactory.isIdentifier(item.id)) out.set(item.id.name, item.id.name);
      }
    } else if (astFactory.isFunctionDeclaration(decl) && decl.id != null) {
      out.set(decl.id.name, decl.id.name);
    }
    for (const spec of stmt.specifiers) {
      if (!astFactory.isExportSpecifier(spec)) continue;
      const local = spec.local.name;
      const exported = astFactory.isStringLiteral(spec.exported)
        ? spec.exported.value
        : spec.exported.name;
      out.set(exported, local);
    }
  }
  return out;
}

function analyzeManifest(
  entry: ModuleEntry,
  linkedImports: Record<string, LinkedImport>,
  options: CompileModulesOptions,
  rootId: string,
): ModuleManifest {
  let manifest: ModuleManifest | undefined;
  const analysisPlugin = (): PluginObject => ({
    visitor: {
      Program(programPath) {
        const compilerPath = programPath as unknown as {
          node: t.Program;
          buildCodeFrameError(message: string): Error;
        };
        normalizeComponentDeclarations(compilerPath);
        const authoredImports = importRefs(compilerPath.node);
        const ctx = createCtx({
          ...compilerOptions(options, rootId),
          moduleId: entry.id,
          linkedImports,
        });
        installLinkedDynamicComponentImports(ctx, compilerPath);
        initializeGeneratedIdentifiers(ctx, compilerPath.node);
        scanTransparentSourceImports(ctx, compilerPath);
        lowerTransparentGroups(ctx, compilerPath);
        scanAndLowerModuleSourceDeclarations(ctx, compilerPath);
        analyzeRouterJsx(ctx, compilerPath);
        runAnalysis(ctx, compilerPath);
        // buildAccessTable also materializes ctx.readers. The returned AST is
        // intentionally discarded here; final emission builds its own table.
        buildAccessTable(ctx);
        const exports: Record<string, LinkedExport> = {};
        const functionTagCandidates = moduleFunctionStringCandidates(
          compilerPath.node,
        );
        for (const [exported, local] of exportedLocals(compilerPath.node)) {
          if (ctx.comps.has(local)) {
            exports[exported] = {
              type: 'component',
              ...analyzedComponentExport(ctx, entry.id, local),
            };
            continue;
          }
          const kind = ctx.state.get(local);
          if (kind !== undefined) {
            exports[exported] = {
              type: 'state',
              kind,
              key: ctx.stateKeys.get(local) ?? `${entry.id}#${local}`,
              transparentSource:
                linkedImports[local]?.type === 'state'
                  ? linkedImports[local]?.transparentSource === true
                  : ctx.transparentModuleSources.has(local),
              tagCandidates: [...(ctx.stateTagCandidates.get(local) ?? [])],
              componentCandidates: componentCandidateKeys(
                ctx,
                ctx.stateComponentCandidates.get(local) ?? [],
              ),
            };
            continue;
          }
          if (ctx.transparentModuleSources.has(local)) {
            exports[exported] = {
              type: 'state',
              kind: 'let',
              key: ctx.transparentModuleSources.get(local) ?? `${entry.id}#${local}`,
              transparentSource: true,
              tagCandidates: [],
              componentCandidates: [],
            };
            continue;
          }
          const summary =
            ctx.importedFunctions.get(local) ??
            (ctx.helpers.has(local) ? summarizeHelper(ctx, local) : undefined);
          if (summary !== undefined) {
            exports[exported] = {
              type: 'function',
              tagCandidates: [
                ...(functionTagCandidates.get(local) ??
                  ctx.functionTagCandidates.get(local) ??
                  []),
              ],
              componentCandidates: componentCandidateKeys(
                ctx,
                ctx.functionComponentCandidates.get(local) ?? [],
              ),
              reads: [...summary.reads].map((key) => canonicalStateKey(ctx, key)).sort(),
              writes: [...summary.writes].map((key) => canonicalStateKey(ctx, key)).sort(),
              boundedWrites: [...summary.boundedWrites]
                .map((key) => canonicalStateKey(ctx, key))
                .sort(),
              parameterWrites: summary.parameterWrites
                .map((effect) => ({
                  index: effect.index,
                  path: [...effect.path],
                }))
                .sort(
                  (a, b) =>
                    a.index - b.index ||
                    a.path.join('.').localeCompare(b.path.join('.')),
                ),
              unbounded: summary.unbounded,
            };
            continue;
          }
          exports[exported] = { type: 'value' };
        }
        manifest = {
          exports,
          imports: authoredImports,
          mounts: applicationMounts(
            compilerPath.node,
            options.runtimePath ?? '@memoized-dom/runtime',
          ),
          components: analyzedComponentDeclarations(entry.id, ctx),
          componentUsages: analyzedComponentUsages(ctx),
          readers: Object.fromEntries(
            [...ctx.readers.entries()]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, patterns]) => [key, [...patterns].sort()]),
          ),
        };
      },
    },
  });

  transformFromAstSync(
    cloneEstreeNode(entry.ast, true) as unknown as Parameters<typeof transformFromAstSync>[0],
    entry.source,
    {
    filename: entry.id,
    plugins: [
      [syntaxJsx as PluginTarget, {}],
      analysisPlugin,
      [transformTypescript as PluginTarget, { isTSX: true }],
    ],
    code: false,
    configFile: false,
    babelrc: false,
    },
  );
  if (manifest === undefined) {
    throw new Error(`memo-dom: failed to analyze module '${entry.id}'`);
  }
  return manifest;
}

/**
 * Bootstrap export identities without analyzing component bodies. This lets
 * the first real analysis already understand imported list/store bindings.
 */
function discoverManifest(
  entry: ModuleEntry,
  options: CompileModulesOptions,
): ModuleManifest {
  let manifest: ModuleManifest | undefined;
  const discoveryPlugin = (): PluginObject => ({
    visitor: {
      Program(programPath) {
        const compilerPath = programPath as unknown as {
          node: t.Program;
          buildCodeFrameError(message: string): Error;
        };
        normalizeComponentDeclarations(compilerPath);
        const locals = new Map<string, LinkedExport>();
        const tagCandidates = moduleStateStringCandidates(compilerPath.node);
        const functionTagCandidates = moduleFunctionStringCandidates(
          compilerPath.node,
        );
        const components = discoverComponentExports(compilerPath.node, entry.id);
        const componentNames = new Set(components.keys());
        const providerSources = new Map(
          (options.transparentAsyncSources ??
            DEFAULT_TRANSPARENT_ASYNC_SOURCES).map(
            (d) => [d.module, d.source] as const,
          ),
        );
        const providerFactories = new Set<string>();
        for (const stmt of compilerPath.node.body) {
          if (!astFactory.isImportDeclaration(stmt)) continue;
          const def = providerSources.get(stmt.source.value);
          if (def === undefined) continue;
          for (const spec of stmt.specifiers) {
            if (
              astFactory.isImportSpecifier(spec) &&
              astFactory.isIdentifier(spec.imported) &&
              spec.imported.name === def[1]
            ) {
              providerFactories.add(spec.local.name);
            }
          }
        }
        for (const [name, component] of components) {
          locals.set(name, { type: 'component', ...component });
        }
        for (const stmt of compilerPath.node.body) {
          const inner = astFactory.isExportNamedDeclaration(stmt) ? stmt.declaration : stmt;
          if (astFactory.isVariableDeclaration(inner)) {
            for (const decl of inner.declarations) {
              if (!astFactory.isIdentifier(decl.id)) continue;
              const init =
                decl.init !== null && astFactory.isExpression(decl.init)
                  ? unwrapTypeExpression(decl.init)
                  : decl.init;
              if (
                astFactory.isArrowFunctionExpression(init) ||
                astFactory.isFunctionExpression(init)
              ) {
                const componentCandidates = directFunctionComponentNames(
                  init,
                  componentNames,
                ).map((name) => `${entry.id}#${name}`);
                locals.set(decl.id.name, {
                  type: 'function',
                  tagCandidates: [
                    ...(functionTagCandidates.get(decl.id.name) ?? []),
                  ],
                  componentCandidates,
                  reads: [],
                  writes: [],
                  boundedWrites: [],
                  parameterWrites: [],
                  unbounded: true,
                });
                continue;
              }
              let kind: StateKind | undefined;
              if (
                astFactory.isCallExpression(init) &&
                astFactory.isIdentifier(init.callee) &&
                providerFactories.has(init.callee.name)
              ) {
                locals.set(decl.id.name, {
                  type: 'state',
                  kind: 'let',
                  key: `${entry.id}#${decl.id.name}`,
                  transparentSource: true,
                } as never);
                continue;
              }
              if (inner.kind === 'let' || inner.kind === 'var') kind = 'let';
              else if (isStoreObject(init)) kind = 'store';
              else if (isConstObjectState(init)) kind = 'const';
              if (kind !== undefined) {
                const names = new Set<string>();
                if (astFactory.isExpression(init)) {
                  directComponentNames(
                    init,
                    componentNames,
                    names,
                  );
                }
                locals.set(decl.id.name, {
                  type: 'state',
                  kind,
                  key: `${entry.id}#${decl.id.name}`,
                  tagCandidates: [...(tagCandidates.get(decl.id.name) ?? [])],
                  componentCandidates: [...names].map(
                    (name) => `${entry.id}#${name}`,
                  ),
                });
              }
            }
          } else if (
            astFactory.isFunctionDeclaration(inner) &&
            inner.id != null &&
            !components.has(inner.id.name)
          ) {
            const componentCandidates = directFunctionComponentNames(
              inner,
              componentNames,
            ).map((name) => `${entry.id}#${name}`);
            locals.set(inner.id.name, {
              type: 'function',
              tagCandidates: [
                ...(functionTagCandidates.get(inner.id.name) ?? []),
              ],
              componentCandidates,
              reads: [],
              writes: [],
              boundedWrites: [],
              parameterWrites: [],
              unbounded: true,
            });
          }
        }
        const exports: Record<string, LinkedExport> = {};
        for (const [exported, local] of exportedLocals(compilerPath.node)) {
          const value = locals.get(local);
          if (value !== undefined) exports[exported] = value;
        }
        manifest = {
          exports,
          imports: importRefs(compilerPath.node),
          mounts: applicationMounts(
            compilerPath.node,
            options.runtimePath ?? '@memoized-dom/runtime',
          ),
          components: [],
          componentUsages: [],
          readers: {},
        };
      },
    },
  });
  transformFromAstSync(
    cloneEstreeNode(entry.ast, true) as unknown as Parameters<typeof transformFromAstSync>[0],
    entry.source,
    {
    filename: entry.id,
    plugins: [
      [syntaxJsx as PluginTarget, {}],
      discoveryPlugin,
      [transformTypescript as PluginTarget, { isTSX: true }],
    ],
    code: false,
    configFile: false,
    babelrc: false,
    },
  );
  if (manifest === undefined) {
    throw new Error(`memo-dom: failed to discover module '${entry.id}'`);
  }
  return manifest;
}

function resolveModule(
  importer: string,
  specifier: string,
  entries: ReadonlyMap<string, ModuleEntry>,
  options: CompileModulesOptions,
): ModuleEntry | undefined {
  const hostResolved = options.resolveImport?.(specifier, importer);
  let resolved = hostResolved;
  if (resolved === undefined) {
    const aliases = Object.entries(options.aliases ?? {}).sort(
      ([a], [b]) => b.length - a.length,
    );
    for (const [prefix, target] of aliases) {
      const matches = prefix.endsWith('/')
        ? specifier.startsWith(prefix)
        : specifier === prefix || specifier.startsWith(`${prefix}/`);
      if (!matches) continue;
      resolved = `${target}${specifier.slice(prefix.length)}`;
      break;
    }
  }
  if (resolved === undefined) {
    if (specifier.startsWith('.')) {
      const joined = posix.normalize(posix.join(posix.dirname(importer), specifier));
      resolved =
        importer.startsWith('./') && !joined.startsWith('../') ? `./${joined}` : joined;
    } else {
      resolved = specifier;
    }
  }
  const base = canonicalModuleId(resolved ?? specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
  ];
  for (const candidate of candidates) {
    const found = entries.get(candidate);
    if (found !== undefined) return found;
  }
  return undefined;
}

function resolveApplicationRoot(
  entries: ReadonlyMap<string, ModuleEntry>,
  manifests: ReadonlyMap<string, ModuleManifest>,
  options: CompileModulesOptions,
): CompiledApplicationRoot | undefined {
  const roots: CompiledApplicationRoot[] = [];
  for (const entry of entries.values()) {
    const manifest = manifests.get(entry.id)!;
    for (const mounted of manifest.mounts) {
      const ref = manifest.imports.find((candidate) => candidate.local === mounted);
      if (ref === undefined || ref.imported === '*') {
        throw new Error(
          `memo-dom: mount root '${mounted}' must be a statically imported component`,
        );
      }
      const target = resolveModule(entry.id, ref.source, entries, options);
      const component =
        target === undefined
          ? undefined
          : manifests.get(target.id)?.exports[ref.imported];
      if (target === undefined || component?.type !== 'component') {
        throw new Error(
          `memo-dom: mount root '${mounted}' does not resolve to a compiled component`,
        );
      }
      const local = component.key.slice(component.key.lastIndexOf('#') + 1);
      roots.push({
        key: component.key,
        moduleId: target.id,
        mountModuleId: entry.id,
        local,
        rootId: local,
      });
    }
  }
  if (roots.length > 1) {
    throw new Error(
      'memo-dom: one connected application graph may contain only one top-level mount() call',
    );
  }
  return roots[0];
}

function relativeModuleSpecifier(importer: string, target: string): string {
  if (!target.startsWith('.')) return target;
  const relative = posix.relative(posix.dirname(importer), target);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function linkedDynamicCandidates(
  importer: ModuleEntry,
  keys: readonly string[],
  manifests: Map<string, ModuleManifest>,
): LinkedDynamicComponentCandidate[] {
  return keys.map((key) => {
    for (const [moduleId, manifest] of manifests) {
      for (const [exported, candidate] of Object.entries(manifest.exports)) {
        if (candidate.type !== 'component' || candidate.key !== key) continue;
        return {
          key: candidate.key,
          source: relativeModuleSpecifier(importer.id, moduleId),
          imported: exported,
          props: [...candidate.props],
          objectProps: candidate.objectProps,
          acceptsUnknownProps: candidate.acceptsUnknownProps,
          hasWholeDefault: candidate.hasWholeDefault,
          listLightweight: candidate.listLightweight,
          delegatedEvents: candidate.delegatedEvents,
          renderProps: [...candidate.renderProps],
          renderCallbacks: [...candidate.renderCallbacks],
          refProps: [...candidate.refProps],
          subtreeReads: [...candidate.subtreeReads],
        };
      }
    }
    throw new Error(
      `memo-dom: dynamic component candidate '${key}' is not exported; export the component so consuming modules can link it`,
    );
  });
}

function linkImports(
  entry: ModuleEntry,
  manifest: ModuleManifest,
  manifests: Map<string, ModuleManifest>,
  entries: ReadonlyMap<string, ModuleEntry>,
  options: CompileModulesOptions,
  renderUsage?: ReadonlyMap<string, RenderUsage>,
): Record<string, LinkedImport> {
  const linked: Record<string, LinkedImport> = {};
  for (const ref of manifest.imports) {
    const target = resolveModule(entry.id, ref.source, entries, options);
    if (target === undefined) {
      // Calls through external imports are conservatively unbounded. If the
      // binding is only read as ordinary data, it remains non-reactive.
      linked[ref.local] = {
        type: 'function',
        tagCandidates: [],
        componentCandidates: [],
        reads: [],
        writes: [],
        boundedWrites: [],
        parameterWrites: [],
        unbounded: true,
      };
      continue;
    }
    if (ref.imported === '*') {
      throw new Error(
        `memo-dom: namespace import '${ref.local}' from '${ref.source}' cannot identify a reactive export; use named imports`,
      );
    }
    const targetExport = manifests.get(target.id)?.exports[ref.imported];
    if (targetExport === undefined) {
      // Early fixed-point passes may not have discovered a re-export yet.
      linked[ref.local] = {
        type: 'function',
        tagCandidates: [],
        componentCandidates: [],
        reads: [],
        writes: [],
        boundedWrites: [],
        parameterWrites: [],
        unbounded: true,
      };
      continue;
    }
    if (targetExport.type === 'state') {
      linked[ref.local] = {
        type: 'state',
        kind: targetExport.kind,
        key: targetExport.key,
        transparentSource: (targetExport as { transparentSource?: boolean })
          .transparentSource,
        tagCandidates: [...targetExport.tagCandidates],
        componentCandidates: linkedDynamicCandidates(
          entry,
          targetExport.componentCandidates,
          manifests,
        ),
      };
    } else if (targetExport.type === 'component') {
      const usage = renderUsage?.get(targetExport.key);
      const renderProps = targetExport.renderProps.filter(
        (prop) =>
          usage?.scalar.has(prop) !== true || usage.jsx.has(prop),
      );
      linked[ref.local] = {
        type: 'component',
        key: targetExport.key,
        props: [...targetExport.props],
        objectProps: targetExport.objectProps,
        acceptsUnknownProps: targetExport.acceptsUnknownProps,
        hasWholeDefault: targetExport.hasWholeDefault,
        listLightweight: targetExport.listLightweight,
        delegatedEvents: targetExport.delegatedEvents,
        renderProps,
        renderCallbacks: [...targetExport.renderCallbacks],
        refProps: [...targetExport.refProps],
        subtreeReads: [...targetExport.subtreeReads],
      };
    } else if (targetExport.type === 'value') {
      linked[ref.local] = {
        type: 'value',
      };
      continue;
    } else {
      if (options.linkFunctionSummaries === false) {
        linked[ref.local] = {
          type: 'function',
          tagCandidates: [...targetExport.tagCandidates],
          componentCandidates: linkedDynamicCandidates(
            entry,
            targetExport.componentCandidates,
            manifests,
          ),
          reads: [],
          writes: [],
          boundedWrites: [],
          parameterWrites: [],
          unbounded: true,
        };
        continue;
      }
      linked[ref.local] = {
        type: 'function',
        tagCandidates: [...targetExport.tagCandidates],
        componentCandidates: linkedDynamicCandidates(
          entry,
          targetExport.componentCandidates,
          manifests,
        ),
        reads: [...targetExport.reads],
        writes: [...targetExport.writes],
        boundedWrites: [...targetExport.boundedWrites],
        parameterWrites: [...targetExport.parameterWrites],
        unbounded: targetExport.unbounded,
      };
    }
  }
  return linked;
}

function stableManifest(manifest: ModuleManifest): string {
  return JSON.stringify(manifest);
}

function reverseModuleDependencies(
  entries: ReadonlyMap<string, ModuleEntry>,
  manifests: ReadonlyMap<string, ModuleManifest>,
  options: CompileModulesOptions,
): Map<string, Set<string>> {
  const importers = new Map<string, Set<string>>();
  for (const id of entries.keys()) importers.set(id, new Set());
  for (const entry of entries.values()) {
    const manifest = manifests.get(entry.id)!;
    for (const ref of manifest.imports) {
      const target = resolveModule(entry.id, ref.source, entries, options);
      if (target !== undefined) importers.get(target.id)!.add(entry.id);
    }
  }
  return importers;
}

function linkManifestWorklist(
  entries: ReadonlyMap<string, ModuleEntry>,
  initial: Map<string, ModuleManifest>,
  options: CompileModulesOptions,
  rootId: string,
): Map<string, ModuleManifest> {
  const manifests = new Map(initial);
  const importers = reverseModuleDependencies(entries, manifests, options);
  const pending = [...entries.keys()];
  const queued = new Set(pending);
  const maximumAnalyses = Math.max(16, entries.size * entries.size * 4);
  let analyses = 0;

  while (pending.length > 0) {
    const id = pending.shift()!;
    queued.delete(id);
    const entry = entries.get(id)!;
    const previous = manifests.get(id)!;
    const linked = linkImports(entry, previous, manifests, entries, options);
    const current = analyzeManifest(entry, linked, options, rootId);
    analyses++;
    if (analyses > maximumAnalyses) {
      throw new Error('memo-dom: cross-module export summaries did not converge');
    }
    if (stableManifest(current) === stableManifest(previous)) continue;

    manifests.set(id, current);
    for (const importer of importers.get(id) ?? []) {
      if (queued.has(importer)) continue;
      queued.add(importer);
      pending.push(importer);
    }
  }
  return manifests;
}

/**
 * Compile a connected set of TS/TSX modules with canonical cross-file state
 * keys. Record keys are source module ids; returned keys are preserved.
 */
function compileLinkedModules(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions,
  sourceMaps: boolean,
): CompiledModules {
  const entries = new Map<string, ModuleEntry>();
  for (const [originalId, source] of Object.entries(modules)) {
    const id = canonicalModuleId(originalId);
    if (entries.has(id)) {
      throw new Error(`memo-dom: duplicate module id after normalization: '${id}'`);
    }
    entries.set(id, {
      originalId,
      id,
      source,
      ast: parseModule(id, source),
    });
  }

  const discovered = new Map<string, ModuleManifest>();
  for (const entry of entries.values()) {
    discovered.set(entry.id, discoverManifest(entry, options));
  }
  const discoveredRoot = resolveApplicationRoot(entries, discovered, options);
  const rootId = discoveredRoot?.rootId ?? 'App';
  const manifests = linkManifestWorklist(
    entries,
    discovered,
    options,
    rootId,
  );
  const applicationRoot = resolveApplicationRoot(entries, manifests, options);
  const linkedRoutes = [...entries.values()].flatMap((entry) => {
    try {
      return collectCompilerRoutes(entry.ast, entry.id);
    } catch (error) {
      throw new Error(`${entry.id}: memo-dom: ${(error as Error).message}`);
    }
  });
  try {
    validateCompilerRouteGraph(linkedRoutes);
  } catch (error) {
    throw new Error(`memo-dom: ${(error as Error).message}`);
  }
  const routeManifestModule =
    applicationRoot?.moduleId ?? entries.values().next().value?.id;

  const renderUsage = new Map<string, RenderUsage>();
  for (const manifest of manifests.values()) {
    for (const usage of manifest.componentUsages) {
      let target = renderUsage.get(usage.target);
      if (target === undefined) {
        target = { jsx: new Set(), scalar: new Set() };
        renderUsage.set(usage.target, target);
      }
      target[usage.kind].add(usage.prop);
    }
  }
  for (const [target, usage] of renderUsage) {
    for (const prop of usage.jsx) {
      if (usage.scalar.has(prop)) {
        throw new Error(
          `memo-dom: component '${target}' prop '${prop}' is used as both scalar data and JSX content; split the prop or component contract`,
        );
      }
    }
  }

  const componentGraph = linkComponentGraph(
    [...manifests.values()].flatMap((manifest) => manifest.components),
    applicationRoot,
  );
  const output: Record<string, string> = {};
  const maps: Record<string, CompilerSourceMap> = {};
  const metadata: Record<string, CompiledModuleMetadata> = {};
  for (const entry of entries.values()) {
    const manifest = manifests.get(entry.id)!;
    metadata[entry.originalId] = {
      componentExports: Object.entries(manifest.exports)
        .filter(
          (entry): entry is [string, ComponentExport] =>
            entry[1].type === 'component',
        )
        .map(([exported, component]) => ({
          exported,
          local:
            manifest.components.find(
              (declaration) => declaration.key === component.key,
            )?.local ?? component.key.slice(component.key.lastIndexOf('#') + 1),
          listLightweight: component.listLightweight,
        }))
        .sort((left, right) => left.local.localeCompare(right.local)),
      stateExports: Object.entries(manifest.exports)
        .filter(
          (entry): entry is [string, StateExport] => entry[1].type === 'state',
        )
        .map(([exported, state]) => ({
          exported,
          kind: state.kind,
          key: state.key,
        }))
        .sort((left, right) => left.exported.localeCompare(right.exported)),
      functionExports: Object.entries(manifest.exports)
        .filter(
          (entry): entry is [string, FunctionExport] =>
            entry[1].type === 'function',
        )
        .map(([exported, summary]) => ({
          exported,
          reads: [...summary.reads],
          writes: [...summary.writes],
          boundedWrites: [...summary.boundedWrites],
          parameterWrites: summary.parameterWrites.map((effect) => ({
            index: effect.index,
            path: [...effect.path],
          })),
          unbounded: summary.unbounded,
        }))
        .sort((left, right) => left.exported.localeCompare(right.exported)),
      readers: Object.fromEntries(
        Object.entries(manifest.readers).map(([key, patterns]) => [
          key,
          [...patterns],
        ]),
      ),
    };
    const linkedImports = linkImports(
      entry,
      manifest,
      manifests,
      entries,
      options,
      renderUsage,
    );
    for (const ref of manifest.imports) {
      const target = resolveModule(entry.id, ref.source, entries, options);
      if (
        target !== undefined &&
        manifests.get(target.id)?.exports[ref.imported] === undefined
      ) {
        throw new Error(
          `memo-dom: '${ref.imported}' is not a linkable state, function, or component export of '${ref.source}'`,
        );
      }
    }
    const linkedComponentPaths: Record<string, string[]> = {};
    const linkedComponentRows: Record<string, LinkedComponentRowUse[]> = {};
    const linkedComponentPropSources: NonNullable<
      MemoDomOptions['linkedComponentPropSources']
    > = {};
    const linkedComponentRenderProps: NonNullable<
      MemoDomOptions['linkedComponentRenderProps']
    > = {};
    for (const declaration of manifest.components) {
      linkedComponentPaths[declaration.local] = [
        ...(componentGraph.paths.get(declaration.key) ?? []),
      ];
      const rows = componentGraph.rows.get(declaration.key);
      if (rows !== undefined) {
        linkedComponentRows[declaration.local] = rows.map((row) => ({
          keyPath: row.keyPath === null ? null : [...row.keyPath],
          sourceKey: row.sourceKey,
          sourceLocal: row.sourceLocal,
        }));
      }
      const propSources = componentGraph.propSources.get(declaration.key);
      if (propSources !== undefined) {
        linkedComponentPropSources[declaration.local] = Object.fromEntries(
          [...propSources].map(([prop, source]) => [
            prop,
            {
              keys: [...source.keys],
              rootFallback: source.rootFallback,
              transparent: source.transparent,
            },
          ]),
        );
      }
      const exported = Object.values(manifest.exports).find(
        (candidate) =>
          candidate.type === 'component' &&
          candidate.key === declaration.key,
      );
      if (exported?.type === 'component') {
        const usage = renderUsage.get(declaration.key);
        linkedComponentRenderProps[declaration.local] =
          exported.renderProps.filter(
            (prop) =>
              usage?.scalar.has(prop) !== true || usage.jsx.has(prop),
          );
      }
    }
    const compileOptions: InternalMemoDomOptions = {
      ...compilerOptions(options, rootId),
      moduleId: entry.id,
      linkedImports,
      linkedComponentPaths,
      linkedComponentRows,
      linkedComponentPropSources,
      linkedComponentRenderProps,
      linkedRoutes,
      emitRouteManifest: entry.id === routeManifestModule,
      ...(applicationRoot?.moduleId === entry.id
        ? { rootComponent: applicationRoot.local }
        : {}),
    };
    if (sourceMaps) {
      const compiled = compileAstDetailed(entry.source, compileOptions, entry.ast);
      output[entry.originalId] = compiled.code;
      maps[entry.originalId] = compiled.map;
    } else {
      output[entry.originalId] = compileAst(entry.source, compileOptions, entry.ast);
    }
  }
  return {
    output,
    maps,
    metadata,
    ...(applicationRoot === undefined ? {} : { applicationRoot }),
  };
}

export function compileModulesDetailed(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions = {},
): CompiledModules {
  return compileLinkedModules(modules, options, true);
}

export function compileModules(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions = {},
): Record<string, string> {
  return compileLinkedModules(modules, options, false).output;
}
