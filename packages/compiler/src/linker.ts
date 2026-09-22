/**
 * Two-pass module linker for canonical cross-file state identity.
 *
 * Pass 1 discovers exported state and function summaries. Subsequent passes
 * resolve import aliases and propagate summaries through re-exports/calls.
 * The final compile receives binding metadata, while emitted ES imports remain
 * untouched for the host bundler.
 */
import type * as t from './ast/compiler-types';
import {
  parseWithEstreeFrontendOrThrow,
  type EstreeFrontend,
  type AstComment,
  memoizedEstreeFrontend,
} from './ast';
import {
  compileAst,
  compileAstDetailed,
  type CompilerSourceMap,
} from './compile';
import {
  linkComponentGraph,
} from './component-linker';
import {
  type InternalMemoDomOptions,
  type LinkedComponentRowUse,
  type MemoDomOptions,
  type ParameterWrite,
  type StateKind,
  type TransparentSourceMethod,
} from './context';
import {
  collectCompilerRoutes,
  validateCompilerRouteGraph,
  type CompilerRouteDefinition,
} from './router';
import type { CompilerRoutedPreparation } from './routed';
import { compilerError } from './errors';
import type {
  CompileModulesOptions,
  ComponentExport,
  FunctionExport,
  ModuleEntry,
  ModuleManifest,
  RenderUsage,
  StateExport,
} from './linking/model';
export type { CompileModulesOptions } from './linking/model';
import {
  canonicalModuleId,
  linkImports,
  resolveModule,
} from './linking/resolution';
import { compilerOptions } from './linking/options';
import { analyzeManifest, discoverManifest } from './linking/discovery';

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
  transparentSourceFactory?: boolean;
  transparentSourceMethod?: TransparentSourceMethod;
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
  /** Compiler-extracted route preparation sites owned by this module. */
  routedPreparations: CompilerRoutedPreparation[];
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
  css?: Record<string, string>;
  applicationRoot?: CompiledApplicationRoot;
}

function parseModule(
  id: string,
  source: string,
  frontend: EstreeFrontend,
): { ast: t.Program; comments: readonly AstComment[]; css?: string } {
  const parsed = parseWithEstreeFrontendOrThrow(frontend, source, {
    filename: id,
    sourceType: 'module',
  });
  return {
    ast: parsed.program as unknown as t.Program,
    comments: parsed.comments,
    css: parsed.css,
  };
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
  linkedRoutes: readonly CompilerRouteDefinition[],
): Map<string, ModuleManifest> {
  const manifests = new Map(initial);
  const importers = reverseModuleDependencies(entries, manifests, options);
  const pending = [...entries.keys()];
  const queued = new Set(pending);
  const maximumAnalyses = Math.max(16, entries.size * entries.size * 4);
  let analyses = 0;

  for (let cursor = 0; cursor < pending.length; cursor++) {
    const id = pending[cursor]!;
    queued.delete(id);
    const entry = entries.get(id)!;
    const previous = manifests.get(id)!;
    const linked = linkImports(entry, previous, manifests, entries, options);
    const current = analyzeManifest(
      entry,
      linked,
      options,
      rootId,
      linkedRoutes,
    );
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

function routeComponentKey(
  route: CompilerRouteDefinition,
  entries: ReadonlyMap<string, ModuleEntry>,
  manifests: ReadonlyMap<string, ModuleManifest>,
  options: CompileModulesOptions,
): string | undefined {
  if (route.component === undefined) return undefined;
  const manifest = manifests.get(route.moduleId);
  const local = manifest?.components.find(
    component => component.local === route.component,
  );
  if (local !== undefined) return local.key;
  const reference = manifest?.imports.find(ref => ref.local === route.component);
  if (reference === undefined) return undefined;
  const target = resolveModule(route.moduleId, reference.source, entries, options);
  const exported = target === undefined
    ? undefined
    : manifests.get(target.id)?.exports[reference.imported];
  return exported?.type === 'component' ? exported.key : undefined;
}

function attachRoutedPreparations(
  routes: readonly CompilerRouteDefinition[],
  entries: ReadonlyMap<string, ModuleEntry>,
  manifests: ReadonlyMap<string, ModuleManifest>,
  options: CompileModulesOptions,
  requireAttachment: boolean,
): CompilerRouteDefinition[] {
  const preparations = new Map<string, CompilerRoutedPreparation[]>();
  for (const [moduleId, manifest] of manifests) {
    for (const preparation of manifest.routedPreparations) {
      const key = `${moduleId}#${preparation.component}`;
      const list = preparations.get(key) ?? [];
      list.push(preparation);
      preparations.set(key, list);
    }
  }
  const consumed = new Set<string>();
  const linked = routes.map(route => {
    const componentKey = routeComponentKey(route, entries, manifests, options);
    const list =
      componentKey === undefined ? undefined : preparations.get(componentKey);
    if (list !== undefined) consumed.add(componentKey!);
    return {
      ...route,
      ...(componentKey === undefined ? {} : { componentKey }),
      ...(list === undefined || list.length === 0
        ? {}
        : { preparations: Object.freeze(list.map(preparation => preparation.id)) }),
    };
  });
  if (requireAttachment) {
    for (const [key, list] of preparations) {
      if (consumed.has(key)) continue;
      const orphan = list[0]!;
      throw compilerError(
        `memo-dom: $routed in component '${orphan.component}' is never prepared because the component is not attached to a route; declare its route region with the route attribute (for example <${orphan.component} route="/path" />) or remove the preparation`,
        orphan.moduleId,
        orphan.line === undefined
          ? null
          : {
              loc: {
                start: {
                  line: orphan.line,
                  column: orphan.column ?? 0,
                },
              },
            },
      );
    }
  }
  return linked;
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
  const frontend = options.frontend ?? memoizedEstreeFrontend;
  const entries = new Map<string, ModuleEntry>();
  for (const [originalId, source] of Object.entries(modules)) {
    const id = canonicalModuleId(originalId);
    if (entries.has(id)) {
      throw new Error(`memo-dom: duplicate module id after normalization: '${id}'`);
    }
    const parsed = parseModule(id, source, frontend);
    entries.set(id, {
      originalId,
      id,
      source,
      ast: parsed.ast,
      comments: parsed.comments,
      css: parsed.css,
    });
  }

  const collectedRoutes = [...entries.values()].flatMap((entry) => {
    try {
      return collectCompilerRoutes(entry.ast, entry.id);
    } catch (error) {
      throw new Error(`${entry.id}: memo-dom: ${(error as Error).message}`);
    }
  });
  try {
    validateCompilerRouteGraph(collectedRoutes);
  } catch (error) {
    throw new Error(`memo-dom: ${(error as Error).message}`);
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
    collectedRoutes,
  );
  const linkedRoutes = attachRoutedPreparations(
    collectedRoutes,
    entries,
    manifests,
    options,
    discoveredRoot !== undefined,
  );
  const applicationRoot = resolveApplicationRoot(entries, manifests, options);
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
  const css: Record<string, string> = {};
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
          ...(summary.transparentSourceFactory === true
            ? { transparentSourceFactory: true }
            : {}),
          ...(summary.transparentSourceMethod === undefined
            ? {}
            : { transparentSourceMethod: summary.transparentSourceMethod }),
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
      routedPreparations: manifest.routedPreparations.map((preparation) => ({
        ...preparation,
        contextFields: [...preparation.contextFields],
      })),
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
        throw compilerError(
          `memo-dom: '${ref.imported}' is not a linkable state, function, or component export of '${ref.source}'`,
          entry.id,
          ref.at,
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
      const compiled = compileAstDetailed(entry.source, compileOptions, entry.ast, entry.comments);
      output[entry.originalId] = compiled.code;
      maps[entry.originalId] = compiled.map;
      const cssOut = compiled.css ?? entry.css;
      if (cssOut) css[entry.originalId] = cssOut;
    } else {
      output[entry.originalId] = compileAst(entry.source, compileOptions, entry.ast, entry.comments);
      if (entry.css) css[entry.originalId] = entry.css;
    }
  }
  return {
    output,
    maps,
    metadata,
    ...(Object.keys(css).length > 0 ? { css } : {}),
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
