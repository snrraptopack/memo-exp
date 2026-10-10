/** Link the complete desktop source graph through the core export worklist. */
import type * as t from '../ast/compiler-types';
import { parseWithEstreeFrontendOrThrow, memoizedEstreeFrontend } from '../ast';
import { canonicalModuleId, linkImports, resolveModule } from '../linking/resolution';
import { discoverManifest, exportedLocals } from '../linking/discovery';
import { linkManifestWorklist } from '../linking/graph';
import type { ModuleEntry, ModuleManifest } from '../linking/model';
import { compileDesktop, type DesktopCompileOptions, type DesktopCompiledSource } from './compile';

export interface DesktopModuleGraph {
  readonly modules: ReadonlyMap<string, DesktopCompiledSource>;
}

/**
 * Discovery precedes emission. State-only modules and barrels participate in
 * the same fixed-point helper summaries as JSX modules, regardless of which
 * import the bundler happens to load first.
 */
export function compileDesktopGraph(
  source: string,
  options: DesktopCompileOptions,
): DesktopModuleGraph {
  const frontend = options.frontend ?? memoizedEstreeFrontend;
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
      const specifier = statement.type === 'ImportDeclaration' ||
        statement.type === 'ExportNamedDeclaration' ||
        statement.type === 'ExportAllDeclaration' ? statement.source?.value : undefined;
      if (typeof specifier !== 'string' || !specifier || specifier.endsWith('.css')) continue;
      if (statement.type === 'ImportDeclaration' && statement.importKind === 'type') continue;
      const resolved = options.readModule?.(specifier, rawId);
      if (!resolved) continue;
      resolutions.set(`${id}\0${specifier}`, canonicalModuleId(resolved.moduleId));
      visit(resolved.moduleId, resolved.source);
    }
  };
  visit(options.moduleId ?? './desktop.tsx', source);

  const linkOptions = {
    frontend,
    runtimePath: '@memoized-dom/runtime',
    resolveImport: (specifier: string, importer: string) =>
      resolutions.get(`${importer}\0${specifier}`),
  };
  const discovered = new Map<string, ModuleManifest>();
  for (const entry of entries.values()) {
    discovered.set(entry.id, discoverManifest(entry, linkOptions));
  }

  // Imported component aliases must be known before strict JSX discovery.
  // This is identity seeding; the shared worklist refines all effect facts.
  for (let round = 0; round < entries.size; round++) {
    let changed = false;
    for (const entry of entries.values()) {
      const manifest = discovered.get(entry.id)!;
      for (const [exported, local] of exportedLocals(entry.ast)) {
        if (manifest.exports[exported]) continue;
        const reference = manifest.imports.find(ref => ref.local === local);
        if (!reference || reference.imported === '*') continue;
        const target = resolveModule(entry.id, reference.source, entries, linkOptions);
        const identity = target && discovered.get(target.id)?.exports[reference.imported];
        if (!identity) continue;
        manifest.exports[exported] = identity;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const manifests = linkManifestWorklist(entries, discovered, linkOptions, 'Desktop', []);
  const modules = new Map<string, DesktopCompiledSource>();
  for (const entry of entries.values()) {
    modules.set(entry.id, compileDesktop(entry.source, {
      ...options,
      allowComponentFree: true,
      moduleId: entry.id,
      linkedImports: linkImports(entry, manifests.get(entry.id)!, manifests, entries, linkOptions),
      activationModules: [...entries.keys()],
      readStylesheet: options.readStylesheet
        ? specifier => options.readStylesheet!(specifier, entry.originalId)
        : undefined,
    }));
  }
  return { modules };
}
