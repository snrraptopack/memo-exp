/** DOM manifest facts use exactly the preparation used by DOM emission. */
import type { ManifestAnalysis } from '../linking/analysis';
import { planAccessReaders } from '../analysis/access-table';
import { createCtx, type DomContext } from './context';
import { prepareProgramAnalysis } from './prepare';

export const domManifestAnalysis: ManifestAnalysis = {
  prepare(path, options) {
    const ctx = createCtx(options);
    prepareProgramAnalysis(ctx, path);
    return ctx;
  },
  readers: planAccessReaders,
  listResourceFree: (ctx, component) => (ctx as DomContext).domOnlyRowComponents.has(component),
};
