/** Source-prop normalization publishes explicit lexical inputs to shared discovery. */
import { scanComponentSources } from '../analysis/transparent-sources';
import { planSourcePropProjections } from '../planning/source-props';
import { requirePresentationOwner } from '../planning/presentation-ownership';
import { lowerSourcePropProjections } from './components/transparent-props';
import { allocatePresentationParameter } from './presentation-parameters';
import type { DomContext } from './context';

export function normalizeComponentSourceBindings(ctx: DomContext): void {
  for (const component of ctx.compPaths.keys()) {
    const sourceProps = lowerSourcePropProjections(ctx,planSourcePropProjections(ctx,component));
    scanComponentSources(ctx,component,sourceProps);
    if (sourceProps.size > 0) allocatePresentationParameter(ctx,requirePresentationOwner(ctx,component));
  }
}
