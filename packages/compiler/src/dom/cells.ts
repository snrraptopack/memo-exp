/** Browser emission defaults for shared module state-cell lowering. */
import { liftModuleStateCells as lift } from '../cells';
import type { DomContext } from './context';
import { generatedIdentifier, md } from './identifiers';

export function liftModuleStateCells(ctx: DomContext, path: Parameters<typeof lift>[1]): void {
  lift(ctx, path, {
    fresh: (name) => generatedIdentifier(ctx, name),
    runtime: (name) => md(ctx, name),
    header: ctx.emission.header,
  });
}
