/** DOM preparation and publication facts for the shared project coordinator. */
import { type BaseNode } from '../ast';
import { compilerError } from '../errors';
import type { ModuleEntry } from '../linking/model';
import type { ManifestAnalysisAdapter } from '../linking/discovery';
import { analyzeRoutedPreparations } from '../routed';
import { createCtx, type DomContext } from './context';
import { installCompilerIntrinsics } from './intrinsics';
import { prepareProgramAnalysis } from './prepare';

export const domManifestAnalysis: ManifestAnalysisAdapter<DomContext> = {
  createContext: createCtx,
  prepare: prepareProgramAnalysis,
  listResourceFree: (context, component) => context.domOnlyRowComponents.has(component),
  routedPreparations: analyzeRoutedPreparations,
};

/** Discovery must see the same generated provider imports as final emission. */
export function prepareDomProjectEntry(entry: ModuleEntry): void {
  installCompilerIntrinsics(createCtx({ moduleId: entry.id }), {
    node: entry.ast,
    buildCodeFrameError: (message, at = entry.ast) =>
      compilerError(message, entry.id, at as BaseNode),
  });
}
