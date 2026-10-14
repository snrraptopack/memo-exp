/** Desktop emission over the existing shared application graph and worklist. */
import { createAnalysisCtx, type Ctx } from '../context/model';
import { refreshAstAnalysis } from '../context';
import { prepareSemanticAnalysis } from '../analysis/pipeline';
import { applicationMountRequests, type ManifestAnalysisAdapter } from '../linking/discovery';
import { isStringLiteral } from '../ast/factory';
import type { CompileModulesOptions } from '../linking/model';
import {
  createProjectEntries,
  discoverProject,
  linkManifestWorklist,
  resolveApplicationRoot
} from '../linking/project';
import { linkImports } from '../linking/resolution';
import { compilerOptions } from '../linking/options';
import { compileDesktop } from './compile';

const sourceAnalysis: ManifestAnalysisAdapter<Ctx> = {
  createContext: createAnalysisCtx,
  prepare(context, path) {
    prepareSemanticAnalysis(context, path, {
      install() {
        refreshAstAnalysis(context, path.node);
      }
    });
  },
  // Neither native lifetime optimization nor route preparation is implemented
  // by this emitter. Shared facts must not inherit DOM-specific assumptions.
  listResourceFree: () => false,
  routedPreparations: () => []
};

export interface DesktopProjectOptions extends CompileModulesOptions {
  /** The desktop build owns CSS imports/extraction and their native lifetime. */
  readonly stylesheetImports?: 'preserve';
}

export function compileDesktopProject(
  modules: Readonly<Record<string, string>>,
  options: DesktopProjectOptions = {}
) {
  const entries = createProjectEntries(modules, options, () => {});
  const discovered = discoverProject(entries, options);
  const root = resolveApplicationRoot(entries, discovered, options);

  if (root === undefined) {
    throw new Error('memo-dom desktop: the entry must mount a statically imported application root');
  }

  // Share browser root discovery; the shell needs the authored container id.
  const requests = applicationMountRequests(
    entries.get(root.mountModuleId)!.ast,
    options.runtimePath ?? '@memoized-dom/runtime'
  );
  const request = requests[0];
  if (!isStringLiteral(request?.target)) {
    throw new Error('memo-dom desktop: this window build requires a literal string mount target');
  }
  const mountTarget = request.target.value;
  if (mountTarget.length === 0 || mountTarget.includes('\0')) {
    throw new Error('memo-dom desktop: the mount target must be a nonempty container id');
  }

  const linked = linkManifestWorklist(
    entries,
    discovered,
    { ...options, moduleStateCells: true },
    root.rootId,
    [],
    sourceAnalysis
  );
  const products = new Map<string, ReturnType<typeof compileDesktop>>();

  for (const entry of entries.values()) {
    const linkedImports = linkImports(
      entry, linked.get(entry.id)!, linked, entries, options
    );
    products.set(entry.id, compileDesktop(entry.source, {
      ...compilerOptions(options, root.rootId),
      frontend: options.frontend,
      stylesheetImports: options.stylesheetImports,
      moduleId: entry.id,
      linkedImports,
      ...(entry.id === root.moduleId ? { rootComponent: root.local } : {})
    }));
  }

  return { root, mountTarget, modules: products };
}
