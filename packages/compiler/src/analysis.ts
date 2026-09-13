/**
 * Compiler pass 1 coordinator: module analysis and access-table preparation.
 *
 * Runs at Program.enter before emission. Each implementation is owned by a
 * focused module under analysis/ or its feature domain; this file owns only
 * their ordering and the stable analysis exports used by other passes.
 *
 * Keep this coordinator shallow. New analysis behavior belongs in the module
 * that owns that rule, and new phases are called here at the point where their
 * required context facts are available.
 */

import type { BaseNode } from './ast';
import {
  refreshAstAnalysis,
  type Ctx,
  type ProgramPath,
} from './context';
import { scanRenderCallbacks } from './components/render-callbacks';
import { scanEffects } from './effects';
import { scanModuleControlFlow } from './module-control-flow';
import {
  analyzeComputed,
  scanComputeds,
} from './analysis/computed';
import {
  scanInstanceDerivations,
  scanInstanceState,
  excludeRefBindings,
} from './analysis/instance';
import { scanOpaqueVolatility } from './analysis/opaque-volatility';
import {
  finalizeInstancePreludes,
  scanInstanceControlFlow,
} from './analysis/instance-control-flow';
import { pathVariants } from './analysis/component-graph';
import { normalizeComponentJsxValues } from './components/jsx-values';
import { normalizeRenderFunctions } from './components/render-functions';
import { normalizeCalculatedListSources } from './lists/calculated-sources';
import {
  normalizeDynamicTags,
  scanLocalDynamicComponentCandidates,
} from './jsx/dynamic-tags';
import { lexicalBindingStringCandidates } from './analysis/type-candidates';
import { foldRenderCallbackSubtreeReads } from './analysis/component-reads';
import { analyzeComponent } from './analysis/component-validation';
import { scanRefProps } from './components/ref-props';
import { generatedIdentifier } from './identifiers';
import {
  registerTransparentSourceRoots,
  scanTransparentSourceBindings,
} from './data-sources';
import {
  scanComponents,
  scanModuleState,
  validateLinkedImports,
} from './analysis/module-scan';
import { scanRenderProps } from './analysis/render-props';
import { collectReads } from './analysis/read-collection';

export {
  isLightweightListedComponent,
  isListLightweightCandidate,
  isLightweightRowComponent,
} from './analysis/component-graph';
export { buildAccessTable } from './analysis/access-table';

export function runAnalysis(ctx: Ctx, programPath: ProgramPath): void {
  refreshAstAnalysis(ctx, programPath.node);
  ctx.bindingTagCandidates = lexicalBindingStringCandidates(
    programPath.node as unknown as BaseNode,
  );
  validateLinkedImports(ctx, programPath);
  scanModuleState(ctx, programPath);
  scanComponents(ctx, programPath);
  scanTransparentSourceBindings(ctx);
  scanRefProps(ctx);
  scanRenderCallbacks(ctx);
  normalizeRenderFunctions(ctx);
  scanLocalDynamicComponentCandidates(ctx, programPath);
  scanRenderProps(ctx);
  normalizeComponentJsxValues(ctx);
  normalizeDynamicTags(ctx);
  normalizeCalculatedListSources(ctx);
  // Normalization can replace declarations and expressions. Rebuild the
  // parser-neutral index before binding-aware analysis consumes those nodes.
  refreshAstAnalysis(ctx, programPath.node);
  scanInstanceState(ctx);
  excludeRefBindings(ctx);
  // Volatility must precede derivation scanning: consts rooted at opaque
  // values ($fetch handles, external clients) qualify as per-instance
  // derivations exactly because their sources change outside the access
  // table, so their chains must replay on every pull-based update.
  scanOpaqueVolatility(ctx);
  registerTransparentSourceRoots(ctx);
  scanComputeds(ctx, programPath); // R13: after helpers are known
  scanModuleControlFlow(ctx, programPath, analyzeComputed);
  scanInstanceDerivations(ctx); // R14/R24: ordered local projections/computeds
  scanInstanceControlFlow(ctx);
  finalizeInstancePreludes(ctx);
  scanEffects(ctx, programPath);
  for (const [name] of ctx.comps) analyzeComponent(ctx, name);
  collectReads(ctx);
  foldRenderCallbackSubtreeReads(ctx);
  // Every ordinary component participates in the private presentation-policy
  // channel. This lets a Group policy cross source-less component boundaries
  // without making policy an authored prop. Listed row factories keep their
  // specialized ABI; their containing list site already owns presentation.
  for (const [name] of ctx.comps) {
    if (
      ctx.listedSites.has(name) ||
      ctx.linkedComponentRows.has(name) ||
      ctx.transparentPolicyParams.has(name)
    ) continue;
    ctx.transparentPolicyParams.set(name, generatedIdentifier(ctx, 'dataPolicies'));
  }
  // acyclicity check runs unconditionally — a state-free recursive component
  // would otherwise slip past (pathVariants is only reached via the table)
  for (const [name] of ctx.comps) pathVariants(ctx, name);

  const listedComponents = new Set([
    ...ctx.listedSites.keys(),
    ...ctx.linkedComponentRows.keys(),
  ]);
  for (const comp of listedComponents) {
    if (ctx.importedComponents.has(comp)) continue;
    const sites = ctx.listedSites.get(comp) ?? [];
    const p = ctx.compPaths.get(comp)!;
    // used both as a row AND a static child: patterns would drop one usage
    if (
      (sites.length > 0 || ctx.linkedComponentRows.has(comp)) &&
      (ctx.comps.get(comp)!.parents.size > 0 ||
        (ctx.conditionalComponentSites.get(comp)?.length ?? 0) > 0)
    ) {
      throw p.buildCodeFrameError(
        `memo-dom: <${comp}> is used both as a list row and as a static child — split it into two components (R7 L1)`,
      );
    }
  }
  refreshAstAnalysis(ctx, programPath.node);
}
