import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode as cloneEstreeNode,
  ESTREE_VISITOR_KEYS,
  walkAst,
  type BaseNode,
} from '../ast';
import { buildAccessTable } from '../analysis';
import { prepareProgramAnalysis } from '../analysis/prepare';
import {
  analyzedComponentDeclarations,
  analyzedComponentExport,
  discoverComponentExports,
} from '../components/manifest';
import { summarizeHelper } from '../helper-summaries';
import {
  moduleFunctionStringCandidates,
  moduleStateStringCandidates,
} from '../analysis/type-candidates';
import {
  canonicalStateKey,
  createCtx,
  isConstObjectState,
  isStoreObject,
  nodeHasJsx,
  unwrapTypeExpression,
  type LinkedImport,
  type StateKind,
  type TransparentSourceMethod,
} from '../context';
import { DEFAULT_TRANSPARENT_ASYNC_SOURCES } from '../context/model';
import { isRenderPropReference } from '../components/children';
import { normalizeComponentDeclarations } from '../components/declarations';
import { compilerError } from '../errors';
import type { CompilerRouteDefinition } from '../router';
import { compilerOptions } from './options';
import type {
  CompileModulesOptions,
  ComponentPropUsage,
  ImportRef,
  LinkedExport,
  ModuleEntry,
  ModuleManifest,
} from './model';

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

function transparentSourceMethod(
  call: t.CallExpression,
  factoryMethods: ReadonlyMap<string, TransparentSourceMethod>,
): TransparentSourceMethod | null {
  const options = call.arguments[1];
  if (!astFactory.isObjectExpression(options)) {
    return astFactory.isIdentifier(call.callee)
      ? factoryMethods.get(call.callee.name) ?? 'GET'
      : 'GET';
  }
  for (const property of options.properties) {
    if (!astFactory.isObjectProperty(property) || property.computed) continue;
    const key = astFactory.isIdentifier(property.key)
      ? property.key.name
      : astFactory.isStringLiteral(property.key)
        ? property.key.value
        : null;
    if (key !== 'method' || !astFactory.isStringLiteral(property.value)) {
      continue;
    }
    const method = property.value.value.toUpperCase();
    if (
      method === 'GET' ||
      method === 'POST' ||
      method === 'PUT' ||
      method === 'PATCH' ||
      method === 'DELETE'
    ) return method;
    return null;
  }
  return 'GET';
}

function directTransparentSourceFunctions(
  program: t.Program,
  factories: ReadonlySet<string>,
  factoryMethods: ReadonlyMap<string, TransparentSourceMethod> = new Map(),
): Map<string, TransparentSourceMethod | null> {
  const result = new Map<string, TransparentSourceMethod | null>();
  const returnsSource = (
    fn: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression,
  ): t.CallExpression | null => {
    const expression = astFactory.isBlockStatement(fn.body)
      ? fn.body.body.length === 1 && astFactory.isReturnStatement(fn.body.body[0])
        ? fn.body.body[0].argument
        : null
      : fn.body;
    const current = expression !== null && astFactory.isExpression(expression)
      ? unwrapTypeExpression(expression)
      : null;
    return astFactory.isCallExpression(current) &&
      astFactory.isIdentifier(current.callee) &&
      factories.has(current.callee.name)
      ? current
      : null;
  };
  for (const statement of program.body) {
    const declaration = astFactory.isExportNamedDeclaration(statement)
      ? statement.declaration
      : statement;
    if (
      astFactory.isFunctionDeclaration(declaration) &&
      declaration.id !== null &&
      returnsSource(declaration) !== null
    ) {
      result.set(
        declaration.id.name,
        transparentSourceMethod(returnsSource(declaration)!, factoryMethods),
      );
      continue;
    }
    if (!astFactory.isVariableDeclaration(declaration)) continue;
    for (const item of declaration.declarations) {
      if (!astFactory.isIdentifier(item.id) || item.init === null) continue;
      const init = astFactory.isExpression(item.init)
        ? unwrapTypeExpression(item.init)
        : item.init;
      if (
        (astFactory.isFunctionExpression(init) ||
          astFactory.isArrowFunctionExpression(init)) &&
        returnsSource(init) !== null
      ) {
        result.set(
          item.id.name,
          transparentSourceMethod(returnsSource(init)!, factoryMethods),
        );
      }
    }
  }
  return result;
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
        refs.push({
          local: spec.local.name,
          imported,
          source: stmt.source.value,
          at: spec as unknown as BaseNode,
        });
      } else if (astFactory.isImportDefaultSpecifier(spec)) {
        refs.push({
          local: spec.local.name,
          imported: 'default',
          source: stmt.source.value,
          at: spec as unknown as BaseNode,
        });
      } else {
        refs.push({
          local: spec.local.name,
          imported: '*',
          source: stmt.source.value,
          at: spec as unknown as BaseNode,
        });
      }
    }
  }
  return refs;
}

function applicationMounts(
  program: t.Program,
  runtimePath: string,
): string[] {
  // Hydrating clients import `hydrate` from the explicit hydration subpath;
  // it roots the application graph exactly like a base-runtime `mount`.
  const mountEntryPaths = new Set([runtimePath, `${runtimePath}/hydrate`]);
  const mountBindings = new Set<string>();
  for (const statement of program.body) {
    if (
      !astFactory.isImportDeclaration(statement) ||
      !mountEntryPaths.has(statement.source.value)
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (
        astFactory.isImportSpecifier(specifier) &&
        (astFactory.isIdentifier(specifier.imported, { name: 'mount' }) ||
          astFactory.isStringLiteral(specifier.imported, { value: 'mount' }) ||
          astFactory.isIdentifier(specifier.imported, { name: 'hydrate' }) ||
          astFactory.isStringLiteral(specifier.imported, { value: 'hydrate' }))
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

export function analyzeManifest(
  entry: ModuleEntry,
  linkedImports: Record<string, LinkedImport>,
  options: CompileModulesOptions,
  rootId: string,
  linkedRoutes: readonly CompilerRouteDefinition[],
): ModuleManifest {
  let manifest: ModuleManifest | undefined;
  const compilerPath = {
    node: cloneEstreeNode(entry.ast, true),
    buildCodeFrameError(message: string, at = entry.ast) {
      return compilerError(message, entry.id, at as unknown as BaseNode);
    },
  };
        const authoredImports = importRefs(compilerPath.node);
        const ctx = createCtx({
          ...compilerOptions(options, rootId),
          moduleId: entry.id,
          linkedImports,
          linkedRoutes,
        });
        prepareProgramAnalysis(ctx, compilerPath);
        // buildAccessTable also materializes ctx.readers. The returned AST is
        // intentionally discarded here; final emission builds its own table.
        buildAccessTable(ctx);
        const exports: Record<string, LinkedExport> = {};
        const functionTagCandidates = moduleFunctionStringCandidates(
          compilerPath.node,
        );
        const transparentFunctionFactories = directTransparentSourceFunctions(
          compilerPath.node,
          ctx.transparentSourceFactories,
          ctx.transparentSourceFactoryMethods,
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
              ...(transparentFunctionFactories.has(local)
                ? {
                    transparentSourceFactory: true,
                    ...(transparentFunctionFactories.get(local) === null
                      ? {}
                      : {
                          transparentSourceMethod:
                            transparentFunctionFactories.get(local)!,
                        }),
                  }
                : {}),
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
  if (manifest === undefined) {
    throw new Error(`memo-dom: failed to analyze module '${entry.id}'`);
  }
  return manifest;
}

/**
 * Bootstrap export identities without analyzing component bodies. This lets
 * the first real analysis already understand imported list/store bindings.
 */
export function discoverManifest(
  entry: ModuleEntry,
  options: CompileModulesOptions,
): ModuleManifest {
  let manifest: ModuleManifest | undefined;
  const compilerPath = {
    node: cloneEstreeNode(entry.ast, true),
    buildCodeFrameError(message: string, at = entry.ast) {
      return compilerError(message, entry.id, at as unknown as BaseNode);
    },
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
              spec.imported.name === def
            ) {
              providerFactories.add(spec.local.name);
            }
          }
        }
        const transparentFunctionFactories = directTransparentSourceFunctions(
          compilerPath.node,
          providerFactories,
        );
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
                  ...(transparentFunctionFactories.has(decl.id.name)
                    ? {
                        transparentSourceFactory: true,
                        ...(transparentFunctionFactories.get(decl.id.name) === null
                          ? {}
                          : {
                              transparentSourceMethod:
                                transparentFunctionFactories.get(decl.id.name)!,
                            }),
                      }
                    : {}),
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
                  tagCandidates: [],
                  componentCandidates: [],
                });
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
              ...(transparentFunctionFactories.has(inner.id.name)
                ? {
                    transparentSourceFactory: true,
                    ...(transparentFunctionFactories.get(inner.id.name) === null
                      ? {}
                      : {
                          transparentSourceMethod:
                            transparentFunctionFactories.get(inner.id.name)!,
                        }),
                  }
                : {}),
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
  if (manifest === undefined) {
    throw new Error(`memo-dom: failed to discover module '${entry.id}'`);
  }
  return manifest;
}
