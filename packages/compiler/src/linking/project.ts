/** Shared parsing, identity bootstrap, mount discovery and fixed-point analysis. */
import { parseWithEstreeFrontendOrThrow, memoizedEstreeFrontend } from '../ast';
import type * as t from '../ast/compiler-types';
import type { Ctx } from '../context/model';
import type { CompilerRouteDefinition } from '../analysis/routes';
import type { CompileModulesOptions, ModuleEntry, ModuleManifest } from './model';
import {
  analyzeManifest,
  discoverManifest,
  exportedLocals,
  type ManifestAnalysisAdapter,
} from './discovery';
import { canonicalModuleId, linkImports, resolveModule } from './resolution';

export interface ProjectApplicationRoot {
  key: string;
  moduleId: string;
  mountModuleId: string;
  local: string;
  rootId: string;
}

/** Parse once, retaining comments/CSS and giving the target its import-installation boundary. */
export function createProjectEntries(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions,
  prepare: (entry: ModuleEntry) => void,
): Map<string, ModuleEntry> {
  const frontend = options.frontend ?? memoizedEstreeFrontend;
  const entries = new Map<string, ModuleEntry>();

  for (const [originalId, source] of Object.entries(modules)) {
    const id = canonicalModuleId(originalId);
    if (entries.has(id)) {
      throw new Error("memo-dom: duplicate module id after normalization: '" + id + "'");
    }
    const parsed = parseWithEstreeFrontendOrThrow(frontend, source, {
      filename: id,
      sourceType: 'module',
    });
    const entry: ModuleEntry = {
      originalId,
      id,
      source,
      ast: parsed.program as unknown as t.Program,
      comments: parsed.comments,
      css: parsed.css,
    };
    prepare(entry);
    entries.set(id, entry);
  }
  return entries;
}

/** Bootstrap preserves the current component-only alias seeding rule on every target. */
export function discoverProject(
  entries: ReadonlyMap<string, ModuleEntry>,
  options: CompileModulesOptions,
): Map<string, ModuleManifest> {
  const discovered = new Map<string, ModuleManifest>();
  for (const entry of entries.values()) {
    discovered.set(entry.id, discoverManifest(entry, options));
  }
  // Seed import-then-export identities before strict JSX/root discovery. A
  // component alias must already be a component even when its importer is
  // analyzed before the barrel; subsequent worklist passes refine its facts.
  for (let round = 0; round < entries.size; round++) {
    let changed = false;
    for (const entry of entries.values()) {
      const manifest = discovered.get(entry.id)!;
      for (const [exported, local] of exportedLocals(entry.ast)) {
        if (manifest.exports[exported] !== undefined) continue;
        const reference = manifest.imports.find(candidate => candidate.local === local);
        if (reference === undefined || reference.imported === '*') continue;
        const target = resolveModule(entry.id, reference.source, entries, options);
        const identity = target === undefined
          ? undefined
          : discovered.get(target.id)?.exports[reference.imported];
        if (identity?.type !== 'component') continue;
        manifest.exports[exported] = identity;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return discovered;
}

/** Resolve ordinary mount imports after bootstrap or after summary convergence. */
export function resolveApplicationRoot(
  entries: ReadonlyMap<string, ModuleEntry>,
  manifests: ReadonlyMap<string, ModuleManifest>,
  options: CompileModulesOptions,
  requireUnique = true,
): ProjectApplicationRoot | undefined {
  const roots: ProjectApplicationRoot[] = [];
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
        moduleId: component.key.slice(0, component.key.lastIndexOf('#')),
        mountModuleId: entry.id,
        local,
        rootId: local,
      });
    }
  }
  if (roots.length > 1) {
    if (requireUnique) {
      throw new Error(
        'memo-dom: one connected application graph may contain only one top-level mount() call',
      );
    }
    return undefined;
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

/** Revisit importers only when their dependency's serialized facts change. */
export function linkManifestWorklist<C extends Ctx>(
  entries: ReadonlyMap<string, ModuleEntry>,
  initial: Map<string, ModuleManifest>,
  options: CompileModulesOptions,
  rootId: string,
  linkedRoutes: readonly CompilerRouteDefinition[],
  adapter: ManifestAnalysisAdapter<C>,
): Map<string, ModuleManifest> {
  const manifests = new Map(initial);
  const importers = reverseModuleDependencies(entries, manifests, options);
  const pending = [...entries.keys()];
  const queued = new Set(pending);
  // Keep the existing finite guard: an adapter cannot keep the build alive
  // indefinitely by publishing unstable summaries through a cyclic graph.
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
      adapter,
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
