/** Shared semantic ordering. Targets supply transformations, never a second scan pipeline. */
import type { BaseNode } from '../ast';
import { refreshAstAnalysis, type Ctx, type ProgramPath } from '../context';
import { normalizeComponentDeclarations } from '../components/declarations';
import { normalizeConditionalJsxDirectives } from '../jsx/conditional-directives';
import { lexicalBindingStringCandidates } from './type-candidates';
import { scanExternalReactiveImports } from './external-reactivity';
import { scanComponents, scanModuleState, validateLinkedImports } from './module-scan';
import { excludeRefBindings, scanInstanceDerivations, scanInstanceState } from './instance';
import { scanOpaqueVolatility } from './opaque-volatility';
import { registerTransparentSourceRoots } from './transparent-sources';
import { analyzeComputed, scanComputeds } from './computed';
import { scanModuleControlFlow } from '../module-control-flow';
import { finalizeInstancePreludes, scanInstanceControlFlow } from './instance-control-flow';
import { scanEffects } from '../effects/discovery';
import { collectReads } from './read-collection';
import { foldRenderCallbackSubtreeReads } from './component-reads';
import { pathVariants } from './component-graph';
import { analyzeModuleListTargets } from './module-list-targets';
import { analyzeOwnerListStructure } from './owner-list-structure';

/** Source-analysis hooks where a target's normalization or ABI differs. */
export interface SemanticAnalysisProfile<C extends Ctx> {
  /** Normalize source bindings and JSX before binding-aware state scans. */
  normalizeComponents?(ctx: C, path: ProgramPath): void;
  validateComponents?(ctx: C, path: ProgramPath): void;
  beforeReads?(ctx: C, path: ProgramPath): void;
  /** Allocate target presentation parameters before source graph validation. */
  preparePresentation?(ctx: C, path: ProgramPath): void;
  /** A target may restrict placements without replacing source graph analysis. */
  validateListPlacements?(ctx: C, path: ProgramPath): void;
  finish?(ctx: C, path: ProgramPath): void;
}

/** Preparation also establishes imports and target-owned source lowering. */
export interface SemanticPreparationProfile<C extends Ctx> extends SemanticAnalysisProfile<C> {
  /** Install target imports and intrinsic bindings before source normalization. */
  install(ctx: C, path: ProgramPath): void;
  normalizeImports?(ctx: C, path: ProgramPath): void;
  initialize?(ctx: C, path: ProgramPath): void;
  subscriptions?(ctx: C): void;
  /** Data, routing and presentation lowering have target-owned ABIs. */
  prepareSources?(ctx: C, path: ProgramPath): void;
  finishPreparation?(ctx: C, path: ProgramPath): void;
}

/** Run facts in dependency order after a target has prepared its source ABIs. */
export function runSemanticAnalysis<C extends Ctx>(
  ctx: C,
  path: ProgramPath,
  profile: SemanticAnalysisProfile<C>,
): void {
  refreshAstAnalysis(ctx, path.node);
  ctx.bindingTagCandidates = lexicalBindingStringCandidates(path.node as unknown as BaseNode);
  validateLinkedImports(ctx, path);
  scanModuleState(ctx, path);
  scanComponents(ctx, path);
  profile.normalizeComponents?.(ctx, path);

  // Normalization can replace declarations; never scan against the old index.
  refreshAstAnalysis(ctx, path.node);
  scanInstanceState(ctx);
  excludeRefBindings(ctx);
  // Opaque sources must be known before const projections are classified.
  scanOpaqueVolatility(ctx);
  registerTransparentSourceRoots(ctx);
  scanComputeds(ctx, path);
  scanModuleControlFlow(ctx, path, analyzeComputed);
  scanInstanceDerivations(ctx);
  scanInstanceControlFlow(ctx);
  finalizeInstancePreludes(ctx);
  scanEffects(ctx, path);
  profile.validateComponents?.(ctx, path);
  profile.beforeReads?.(ctx, path);
  collectReads(ctx);
  foldRenderCallbackSubtreeReads(ctx);
  profile.preparePresentation?.(ctx, path);

  // Every target validates cycles, even for state-free component graphs.
  for (const name of ctx.comps.keys()) {
    pathVariants(ctx, name);
  }
  profile.validateListPlacements?.(ctx, path);
  refreshAstAnalysis(ctx, path.node);
  analyzeModuleListTargets(ctx);
  analyzeOwnerListStructure(ctx);
  profile.finish?.(ctx, path);
}

/** Used by emission and fixed-point manifest analysis for either destination. */
export function prepareSemanticAnalysis<C extends Ctx>(
  ctx: C,
  path: ProgramPath,
  profile: SemanticPreparationProfile<C>,
): void {
  profile.install(ctx, path);
  normalizeComponentDeclarations(path);
  profile.normalizeImports?.(ctx, path);
  normalizeConditionalJsxDirectives(path);
  profile.initialize?.(ctx, path);
  scanExternalReactiveImports(ctx, path);
  profile.subscriptions?.(ctx);
  profile.prepareSources?.(ctx, path);
  runSemanticAnalysis(ctx, path, profile);
  profile.finishPreparation?.(ctx, path);
}
