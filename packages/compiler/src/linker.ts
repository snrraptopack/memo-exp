/**
 * Two-pass module linker for canonical cross-file state identity.
 *
 * Pass 1 discovers exported state and function summaries. Subsequent passes
 * resolve import aliases and propagate summaries through re-exports/calls.
 * The final compile receives binding metadata, while emitted ES imports remain
 * untouched for the host bundler.
 */
import { posix } from 'node:path';
import { transformSync } from '@babel/core';
import syntaxJsx from '@babel/plugin-syntax-jsx';
import transformTypescript from '@babel/plugin-transform-typescript';
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { runAnalysis } from './analysis';
import { compile } from './compile';
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
import {
  canonicalStateKey,
  createCtx,
  isConstObjectState,
  isStoreObject,
  nodeHasJsx,
  type LinkedImport,
  type LinkedDynamicComponentCandidate,
  type LinkedComponentRowUse,
  type MemoDomOptions,
  type ParameterWrite,
  type StateKind,
} from './context';
import { isRenderPropReference } from './components/children';
import { installLinkedDynamicComponentImports } from './jsx/dynamic-tags';
import { normalizeComponentDeclarations } from './components/declarations';

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
}

interface StateExport {
  type: 'state';
  kind: StateKind;
  key: string;
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

type LinkedExport = StateExport | FunctionExport | ComponentExport;

interface ImportRef {
  local: string;
  imported: string;
  source: string;
}

interface ModuleManifest {
  exports: Record<string, LinkedExport>;
  imports: ImportRef[];
  components: ComponentGraphNode[];
  componentUsages: ComponentPropUsage[];
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

function compilerOptions(options: CompileModulesOptions): MemoDomOptions {
  return {
    ...(options.runtimePath === undefined ? {} : { runtimePath: options.runtimePath }),
    ...(options.rootId === undefined ? {} : { rootId: options.rootId }),
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
    componentPath.traverse({
      JSXElement(path) {
        const opening = path.node.openingElement;
        const tag = opening.name;
        if (!t.isJSXIdentifier(tag) || !/^[A-Z]/.test(tag.name)) return;
        const target =
          ctx.importedComponents.get(tag.name)?.key ??
          (ctx.comps.has(tag.name) ? `${ctx.moduleId}#${tag.name}` : null);
        if (target === null) return;

        for (const attribute of opening.attributes) {
          if (!t.isJSXAttribute(attribute)) continue;
          const name = t.isJSXIdentifier(attribute.name)
            ? attribute.name.name
            : attribute.name.name.name;
          const value = attribute.value;
          if (
            t.isJSXElement(value) ||
            t.isJSXFragment(value) ||
            (t.isJSXExpressionContainer(value) &&
              t.isExpression(value.expression) &&
              (nodeHasJsx(value.expression) ||
                isRenderPropReference(ctx, owner, value.expression)))
          ) {
            record(target, name, 'jsx');
          } else {
            record(target, name, 'scalar');
          }
        }
        if (
          path.node.children.some(
            (child) => !t.isJSXText(child) || child.value.trim() !== '',
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
  while (
    t.isTSAsExpression(expression) ||
    t.isTSTypeAssertion(expression) ||
    t.isTSNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }
  if (t.isIdentifier(expression)) {
    if (componentNames.has(expression.name)) output.add(expression.name);
    return;
  }
  if (t.isConditionalExpression(expression)) {
    directComponentNames(expression.consequent, componentNames, output);
    directComponentNames(expression.alternate, componentNames, output);
    return;
  }
  if (t.isLogicalExpression(expression)) {
    directComponentNames(expression.right, componentNames, output);
    return;
  }
  if (t.isObjectExpression(expression)) {
    for (const property of expression.properties) {
      if (t.isObjectProperty(property) && t.isExpression(property.value)) {
        directComponentNames(property.value, componentNames, output);
      }
    }
    return;
  }
  if (t.isArrayExpression(expression)) {
    for (const element of expression.elements) {
      if (element != null && !t.isSpreadElement(element)) {
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
  if (t.isExpression(fn.body)) {
    directComponentNames(fn.body, componentNames, output);
    return [...output];
  }
  const visit = (node: t.Node): void => {
    if (t.isFunction(node)) return;
    if (t.isReturnStatement(node)) {
      if (t.isExpression(node.argument)) {
        directComponentNames(node.argument, componentNames, output);
      }
      return;
    }
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
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
    if (!t.isImportDeclaration(stmt) || stmt.importKind === 'type') continue;
    for (const spec of stmt.specifiers) {
      if (t.isImportSpecifier(spec)) {
        if (spec.importKind === 'type') continue;
        const imported = t.isIdentifier(spec.imported)
          ? spec.imported.name
          : spec.imported.value;
        refs.push({ local: spec.local.name, imported, source: stmt.source.value });
      } else if (t.isImportDefaultSpecifier(spec)) {
        refs.push({ local: spec.local.name, imported: 'default', source: stmt.source.value });
      } else {
        refs.push({ local: spec.local.name, imported: '*', source: stmt.source.value });
      }
    }
  }
  return refs;
}

function exportedLocals(program: t.Program): Map<string, string> {
  const out = new Map<string, string>();
  for (const stmt of program.body) {
    if (t.isExportDefaultDeclaration(stmt)) {
      if (
        (t.isFunctionDeclaration(stmt.declaration) ||
          t.isClassDeclaration(stmt.declaration)) &&
        stmt.declaration.id != null
      ) {
        out.set('default', stmt.declaration.id.name);
      } else if (t.isIdentifier(stmt.declaration)) {
        out.set('default', stmt.declaration.name);
      }
      continue;
    }
    if (!t.isExportNamedDeclaration(stmt)) continue;
    if (stmt.source !== null) {
      throw new Error(
        `memo-dom: re-export-from declarations are not supported by compileModules(); import then export the binding explicitly`,
      );
    }
    const decl = stmt.declaration;
    if (t.isVariableDeclaration(decl)) {
      for (const item of decl.declarations) {
        if (t.isIdentifier(item.id)) out.set(item.id.name, item.id.name);
      }
    } else if (t.isFunctionDeclaration(decl) && decl.id != null) {
      out.set(decl.id.name, decl.id.name);
    }
    for (const spec of stmt.specifiers) {
      if (!t.isExportSpecifier(spec)) continue;
      const local = spec.local.name;
      const exported = t.isIdentifier(spec.exported)
        ? spec.exported.name
        : spec.exported.value;
      out.set(exported, local);
    }
  }
  return out;
}

function analyzeManifest(
  entry: ModuleEntry,
  linkedImports: Record<string, LinkedImport>,
  options: CompileModulesOptions,
): ModuleManifest {
  let manifest: ModuleManifest | undefined;
  const analysisPlugin = (): { visitor: { Program(path: NodePath<t.Program>): void } } => ({
    visitor: {
      Program(programPath) {
        normalizeComponentDeclarations(programPath);
        const authoredImports = importRefs(programPath.node);
        const ctx = createCtx({
          ...compilerOptions(options),
          moduleId: entry.id,
          linkedImports,
        });
        installLinkedDynamicComponentImports(ctx, programPath);
        runAnalysis(ctx, programPath);
        const exports: Record<string, LinkedExport> = {};
        const functionTagCandidates = moduleFunctionStringCandidates(
          programPath.node,
        );
        for (const [exported, local] of exportedLocals(programPath.node)) {
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
              tagCandidates: [...(ctx.stateTagCandidates.get(local) ?? [])],
              componentCandidates: componentCandidateKeys(
                ctx,
                ctx.stateComponentCandidates.get(local) ?? [],
              ),
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
          }
        }
        manifest = {
          exports,
          imports: authoredImports,
          components: analyzedComponentDeclarations(entry.id, ctx),
          componentUsages: analyzedComponentUsages(ctx),
        };
      },
    },
  });

  transformSync(entry.source, {
    filename: entry.id,
    plugins: [
      [syntaxJsx as any, {}],
      analysisPlugin,
      [transformTypescript as any, { isTSX: true }],
    ],
    configFile: false,
    babelrc: false,
  });
  if (manifest === undefined) {
    throw new Error(`memo-dom: failed to analyze module '${entry.id}'`);
  }
  return manifest;
}

/**
 * Bootstrap export identities without analyzing component bodies. This lets
 * the first real analysis already understand imported list/store bindings.
 */
function discoverManifest(entry: ModuleEntry): ModuleManifest {
  let manifest: ModuleManifest | undefined;
  const discoveryPlugin = (): { visitor: { Program(path: NodePath<t.Program>): void } } => ({
    visitor: {
      Program(programPath) {
        normalizeComponentDeclarations(programPath);
        const locals = new Map<string, LinkedExport>();
        const tagCandidates = moduleStateStringCandidates(programPath.node);
        const functionTagCandidates = moduleFunctionStringCandidates(
          programPath.node,
        );
        const components = discoverComponentExports(programPath, entry.id);
        const componentNames = new Set(components.keys());
        for (const [name, component] of components) {
          locals.set(name, { type: 'component', ...component });
        }
        for (const stmt of programPath.node.body) {
          const inner = t.isExportNamedDeclaration(stmt) ? stmt.declaration : stmt;
          if (t.isVariableDeclaration(inner)) {
            for (const decl of inner.declarations) {
              if (!t.isIdentifier(decl.id)) continue;
              if (
                t.isArrowFunctionExpression(decl.init) ||
                t.isFunctionExpression(decl.init)
              ) {
                const componentCandidates = directFunctionComponentNames(
                  decl.init,
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
              if (inner.kind === 'let' || inner.kind === 'var') kind = 'let';
              else if (isStoreObject(decl.init)) kind = 'store';
              else if (isConstObjectState(decl.init)) kind = 'const';
              if (kind !== undefined) {
                const names = new Set<string>();
                if (t.isExpression(decl.init)) {
                  directComponentNames(
                    decl.init,
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
            t.isFunctionDeclaration(inner) &&
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
        for (const [exported, local] of exportedLocals(programPath.node)) {
          const value = locals.get(local);
          if (value !== undefined) exports[exported] = value;
        }
        manifest = {
          exports,
          imports: importRefs(programPath.node),
          components: [],
          componentUsages: [],
        };
      },
    },
  });
  transformSync(entry.source, {
    filename: entry.id,
    plugins: [
      [syntaxJsx as any, {}],
      discoveryPlugin,
      [transformTypescript as any, { isTSX: true }],
    ],
    configFile: false,
    babelrc: false,
  });
  if (manifest === undefined) {
    throw new Error(`memo-dom: failed to discover module '${entry.id}'`);
  }
  return manifest;
}

function resolveModule(
  importer: string,
  specifier: string,
  entries: Map<string, ModuleEntry>,
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
          renderProps: [...candidate.renderProps],
          renderCallbacks: [...candidate.renderCallbacks],
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
  entries: Map<string, ModuleEntry>,
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
        renderProps,
        renderCallbacks: [...targetExport.renderCallbacks],
        subtreeReads: [...targetExport.subtreeReads],
      };
    } else {
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

/**
 * Compile a connected set of TS/TSX modules with canonical cross-file state
 * keys. Record keys are source module ids; returned keys are preserved.
 */
export function compileModules(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions = {},
): Record<string, string> {
  const entries = new Map<string, ModuleEntry>();
  for (const [originalId, source] of Object.entries(modules)) {
    const id = canonicalModuleId(originalId);
    if (entries.has(id)) {
      throw new Error(`memo-dom: duplicate module id after normalization: '${id}'`);
    }
    entries.set(id, { originalId, id, source });
  }

  let manifests = new Map<string, ModuleManifest>();
  for (const entry of entries.values()) {
    manifests.set(entry.id, discoverManifest(entry));
  }

  for (let pass = 0; pass <= entries.size; pass++) {
    let changed = false;
    const next = new Map<string, ModuleManifest>();
    for (const entry of entries.values()) {
      const previous = manifests.get(entry.id)!;
      const linked = linkImports(entry, previous, manifests, entries, options);
      const current = analyzeManifest(entry, linked, options);
      next.set(entry.id, current);
      if (stableManifest(current) !== stableManifest(previous)) changed = true;
    }
    manifests = next;
    if (!changed) break;
    if (pass === entries.size) {
      throw new Error('memo-dom: cross-module export summaries did not converge');
    }
  }

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
    options.rootId ?? 'App',
  );
  const output: Record<string, string> = {};
  for (const entry of entries.values()) {
    const manifest = manifests.get(entry.id)!;
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
    output[entry.originalId] = compile(entry.source, {
      ...compilerOptions(options),
      moduleId: entry.id,
      linkedImports,
      linkedComponentPaths,
      linkedComponentRows,
      linkedComponentPropSources,
      linkedComponentRenderProps,
    });
  }
  return output;
}
