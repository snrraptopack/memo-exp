/** Shared project discovery: manifests plus import-then-export identity seeding. */
import type {
  CompileModulesOptions,
  LinkResolutionOptions,
  ModuleEntry,
  ModuleManifest,
} from './model';
import { discoverManifest, exportedLocals } from './discovery';
import { resolveModule, canonicalModuleId } from './resolution';
import { parseWithEstreeFrontendOrThrow, type EstreeFrontend } from '../ast';
import type * as t from '../ast/compiler-types';
import { compilerError } from '../errors';

export interface ModuleSource {
  moduleId: string;
  source: string;
}
export type ModuleReader = (specifier: string, importer: string) => ModuleSource | undefined;

/** Source collection is separate from identity discovery and fixed-point analysis. */
export function collectProject(
  source: string,
  moduleId: string,
  frontend: EstreeFrontend,
  read?: ModuleReader,
): {
  entries: Map<string, ModuleEntry>;
  resolveImport(specifier: string, importer: string): string | undefined;
} {
  const entries = new Map<string, ModuleEntry>();
  const resolutions = new Map<string, string>();
  const visit = (rawId: string, contents: string): void => {
    const id = canonicalModuleId(rawId);
    if (entries.has(id)) return;
    const parsed = parseWithEstreeFrontendOrThrow(frontend, contents, {
      filename: id,
      sourceType: 'module',
    });
    const ast = parsed.program as t.Program;
    entries.set(id, { id, originalId: rawId, source: contents, ast });
    for (const statement of ast.body) {
      if (statement.type === 'ImportDeclaration' && statement.importKind === 'type') continue;
      const specifier =
        statement.type === 'ImportDeclaration' ||
        statement.type === 'ExportNamedDeclaration' ||
        statement.type === 'ExportAllDeclaration'
          ? statement.source?.value
          : undefined;
      if (typeof specifier !== 'string' || !specifier || specifier.endsWith('.css')) continue;
      const resolved = read?.(specifier, rawId);
      if (!resolved) continue;
      resolutions.set(`${id}\0${specifier}`, canonicalModuleId(resolved.moduleId));
      visit(resolved.moduleId, resolved.source);
    }
  };
  visit(moduleId, source);
  return {
    entries,
    resolveImport: (specifier, importer) => resolutions.get(`${importer}\0${specifier}`),
  };
}

/**
 * Seed import-then-export identities before strict discovery. A re-exported
 * alias must already carry its identity even when its importer is analyzed
 * before the barrel. Components, helpers and state use the same bootstrap
 * rule on every target; subsequent worklist passes refine these provisional facts.
 */
export function seedReexportIdentities(
  entries: ReadonlyMap<string, ModuleEntry>,
  discovered: ReadonlyMap<string, ModuleManifest>,
  options: LinkResolutionOptions,
): void {
  for (let round = 0; round < entries.size; round++) {
    let changed = false;
    for (const entry of entries.values()) {
      const manifest = discovered.get(entry.id)!;
      for (const [exported, local] of exportedLocals(entry.ast)) {
        if (manifest.exports[exported] !== undefined) continue;
        const reference = manifest.imports.find((candidate) => candidate.local === local);
        if (reference === undefined || reference.imported === '*') continue;
        const target = resolveModule(entry.id, reference.source, entries, options);
        const identity =
          target === undefined ? undefined : discovered.get(target.id)?.exports[reference.imported];
        if (identity === undefined) continue;
        manifest.exports[exported] = identity;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

/** Discover every module's manifest, then seed re-export identities. */
export function discoverProject(
  entries: ReadonlyMap<string, ModuleEntry>,
  options: CompileModulesOptions,
): Map<string, ModuleManifest> {
  const discovered = new Map<string, ModuleManifest>();
  for (const entry of entries.values()) discovered.set(entry.id, discoverManifest(entry, options));
  seedReexportIdentities(entries, discovered, options);
  assertResolvableReexports(entries, discovered, options);
  return discovered;
}

/** An unresolved alias cycle has no defining export for the worklist to refine. */
function assertResolvableReexports(
  entries: ReadonlyMap<string, ModuleEntry>,
  discovered: ReadonlyMap<string, ModuleManifest>,
  options: LinkResolutionOptions,
): void {
  const done = new Set<string>();
  const active = new Set<string>();
  const visit = (entry: ModuleEntry, exported: string): void => {
    if (discovered.get(entry.id)!.exports[exported] !== undefined) return;
    const key = `${entry.id}\0${exported}`;
    if (done.has(key)) return;
    const local = exportedLocals(entry.ast).get(exported);
    const reference = discovered.get(entry.id)!.imports.find((ref) => ref.local === local);
    if (!reference || reference.imported === '*') return;
    if (active.has(key)) {
      throw compilerError(
        `memo-dom: cyclic re-export '${exported}' has no defining binding`,
        entry.id,
        reference.at,
      );
    }
    const target = resolveModule(entry.id, reference.source, entries, options);
    if (!target) return;
    active.add(key);
    visit(target, reference.imported);
    active.delete(key);
    done.add(key);
  };
  for (const entry of entries.values()) {
    for (const exported of exportedLocals(entry.ast).keys()) visit(entry, exported);
  }
}
