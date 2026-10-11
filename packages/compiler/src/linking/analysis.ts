/** A graph asks its target for facts without importing that target's emitter. */
import type { AccessReaderPlan } from '../analysis/access-table';
import type { AnalysisOptions, Ctx, ProgramPath } from '../context';

export interface ManifestAnalysis {
  prepare(path: ProgramPath, options: AnalysisOptions): Ctx;
  readers(ctx: Ctx): AccessReaderPlan;
  /** Resource-free row lowering is an optional target optimization. */
  listResourceFree(ctx: Ctx, component: string): boolean;
}
