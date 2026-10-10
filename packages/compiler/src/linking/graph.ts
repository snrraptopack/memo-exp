/** Shared fixed-point propagation of canonical module exports and helper effects. */
import type { CompileModulesOptions, ModuleEntry, ModuleManifest } from './model';
import type { CompilerRouteDefinition } from '../analysis/routes';
import { resolveModule, linkImports } from './resolution';
import { analyzeManifest } from './discovery';

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

export function linkManifestWorklist(
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
