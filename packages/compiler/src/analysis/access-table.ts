import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { canonicalStateKey, type Ctx } from '../context';
import { md } from '../identifiers';
import { componentPatterns, pathVariants } from './component-graph';
import { expandRenderSlotPaths } from './slot-paths';

// Compiler/runtime protocol. This key is internal access-table metadata, not
// an authored state path; ordinary state writes cannot match the NUL suffix.
const LIST_STRUCTURE_READER_SUFFIX = '\0memo-dom:list-structure-reader';

/** Build and install the module's state-reader access table. */
export function buildAccessTable(ctx: Ctx): t.Statement | null {
  const canonicalListSources = new Set(
    [...ctx.listSources].map((source) => canonicalStateKey(ctx, source)),
  );
  const componentOwnsListSource = (
    component: string,
    variable: string,
  ): boolean => {
    const source = canonicalStateKey(ctx, variable);
    for (const candidate of ctx.componentListSources.get(component) ?? []) {
      if (canonicalStateKey(ctx, candidate) === source) return true;
    }
    return false;
  };
  const add = (
    variable: string,
    patterns: readonly string[],
    structuralPatterns: readonly string[] = patterns,
  ): void => {
    const key = canonicalStateKey(ctx, variable);
    let readers = ctx.readers.get(key);
    if (!readers) ctx.readers.set(key, (readers = new Set()));
    for (const pattern of patterns) readers.add(pattern);
    if (!canonicalListSources.has(key)) return;
    const structuralKey = `${key}${LIST_STRUCTURE_READER_SUFFIX}`;
    let structuralReaders = ctx.readers.get(structuralKey);
    if (!structuralReaders) {
      ctx.readers.set(structuralKey, (structuralReaders = new Set()));
    }
    for (const pattern of structuralPatterns) structuralReaders.add(pattern);
  };

  for (const [component, variables] of ctx.compReads) {
    if (variables.size === 0) continue;
    const patterns = componentPatterns(ctx, component);
    const ownerPatterns = expandRenderSlotPaths(
      ctx,
      pathVariants(ctx, component),
    );
    for (const variable of variables) {
      add(
        variable,
        patterns,
        componentOwnsListSource(component, variable) ? ownerPatterns : patterns,
      );
    }
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
      astFactory.objectProperty(
        astFactory.stringLiteral(variable),
        astFactory.arrayExpression(
          [...readers].sort().map((reader) => astFactory.stringLiteral(reader)),
        ),
      ),
    );
  return astFactory.expressionStatement(
    astFactory.callExpression(md(ctx, 'installAccessTable'), [
      astFactory.objectExpression([
        astFactory.objectProperty(
          astFactory.identifier('readers'),
          astFactory.objectExpression(readerProperties),
        ),
      ]),
      astFactory.stringLiteral(ctx.rootId),
      astFactory.stringLiteral(ctx.moduleId),
    ]),
  );
}
