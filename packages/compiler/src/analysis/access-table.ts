import * as t from '@babel/types';
import { canonicalStateKey, type Ctx } from '../context';
import { md } from '../identifiers';
import { componentPatterns, pathVariants } from './component-graph';
import { expandRenderSlotPaths } from './slot-paths';

/** Build and install the module's state-reader access table. */
export function buildAccessTable(ctx: Ctx): t.Statement | null {
  const add = (variable: string, patterns: readonly string[]): void => {
    const key = canonicalStateKey(ctx, variable);
    let readers = ctx.readers.get(key);
    if (!readers) ctx.readers.set(key, (readers = new Set()));
    for (const pattern of patterns) readers.add(pattern);
  };

  for (const [component, variables] of ctx.compReads) {
    if (variables.size === 0) continue;
    const patterns = componentPatterns(ctx, component);
    for (const variable of variables) add(variable, patterns);
  }
  for (const { owner, suffix, vars } of ctx.rowReads.values()) {
    const patterns = expandRenderSlotPaths(
      ctx,
      pathVariants(ctx, owner).flatMap((variant) => [
        `${variant}/${suffix}/Row[*]`,
        `${variant}/${suffix}/Row[*]/*`,
      ]),
    );
    for (const variable of vars) add(variable, patterns);
  }
  for (const { owner, suffix, vars } of ctx.condReads.values()) {
    const patterns = expandRenderSlotPaths(
      ctx,
      pathVariants(ctx, owner).flatMap((variant) => [
        `${variant}/${suffix}`,
        `${variant}/${suffix}/*`,
      ]),
    );
    for (const variable of vars) add(variable, patterns);
  }
  for (const [component, sites] of ctx.effects) {
    const ownerPatterns = componentPatterns(ctx, component).filter(
      (pattern) => !pattern.endsWith('/*'),
    );
    for (const site of sites) {
      const basePatterns = ownerPatterns.map(
        (pattern) => `${pattern}/$effects/${site.index}`,
      );
      const callbackPatterns =
        site.condition === null
          ? basePatterns
          : basePatterns.map((pattern) => `${pattern}/$active`);
      for (const read of site.moduleReads) add(read, callbackPatterns);
      for (const read of site.conditionModuleReads) add(read, basePatterns);
    }
  }
  for (const site of ctx.moduleEffects) {
    const callbackId =
      site.condition === null ? site.entityId : `${site.entityId}/$active`;
    for (const read of site.moduleReads) add(read, [callbackId]);
    for (const read of site.conditionModuleReads) {
      add(read, [site.entityId]);
    }
  }
  for (const [name, info] of ctx.computeds) {
    const entityId =
      `${ctx.rootId}/$computed/${encodeURIComponent(ctx.moduleId)}#${name}`;
    for (const key of info.reads) add(key, [entityId]);
  }
  for (const flow of ctx.moduleControlFlow) {
    for (const key of flow.sources) add(key, [flow.entityId]);
  }

  if (ctx.readers.size === 0) return null;

  const readerProperties = [...ctx.readers.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([variable, readers]) =>
      t.objectProperty(
        t.stringLiteral(variable),
        t.arrayExpression(
          [...readers].sort().map((reader) => t.stringLiteral(reader)),
        ),
      ),
    );
  return t.expressionStatement(
    t.callExpression(md(ctx, 'installAccessTable'), [
      t.objectExpression([
        t.objectProperty(
          t.identifier('readers'),
          t.objectExpression(readerProperties),
        ),
      ]),
      t.stringLiteral(ctx.rootId),
      t.stringLiteral(ctx.moduleId),
    ]),
  );
}
