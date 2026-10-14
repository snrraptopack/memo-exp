/** Desktop selection of host-neutral semantic analysis phases. */
import { scanRenderProps } from '../analysis/render-props';
import type { SemanticAnalysisProfile } from '../analysis/pipeline';
import type { Ctx } from '../context/model';

/**
 * Render-slot discovery is source semantics shared with the DOM compiler.
 * Desktop selects the existing pass here so project discovery and final
 * emission publish the same component prop contract.
 */
export const desktopAnalysisProfile: Pick<
  SemanticAnalysisProfile<Ctx>,
  'normalizeComponents'
> = {
  normalizeComponents(context) {
    scanRenderProps(context);
  },
};
