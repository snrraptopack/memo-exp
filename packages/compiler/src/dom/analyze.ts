/**
 * DOM normalization and ABI hooks for the shared semantic coordinator.
 *
 * Runs at Program.enter before emission. Each implementation is owned by a
 * focused module under analysis/ or its feature domain; this file owns only
 * target-specific transformations at declared semantic hook points.
 *
 * Keep this coordinator shallow. New analysis behavior belongs in the module
 * that owns that rule. Shared phase ordering lives in analysis/pipeline.ts.
 */

import { refreshAstAnalysis, type ProgramPath } from '../context';
import { type DomContext as Ctx } from './context';
import { runSemanticAnalysis, type SemanticAnalysisProfile } from '../analysis/pipeline';
import { scanRenderCallbacks } from '../components/render-callbacks';
import { isListLightweightCandidate } from '../analysis/component-graph';
import { normalizeComponentJsxValues } from '../components/jsx-values';
import { planPrivateRowProps } from '../planning/private-row-props';
import { lowerPrivateRowProps } from './private-row-props';
import { analyzeComponentProps } from '../components/props';
import { normalizeRenderFunctions } from '../components/render-functions';
import { planCalculatedListSources } from '../planning/calculated-list-sources';
import { lowerCalculatedListSources } from './calculated-list-sources';
import {
  planDynamicTags,
  recordDynamicTagPropModes,
  scanLocalDynamicComponentCandidates,
} from '../planning/dynamic-tags';
import { lowerDynamicTags } from './dynamic-tags';
import { analyzeComponent } from '../analysis/component-validation';
import { scanRefProps } from '../components/ref-props';
import { allocatePresentationParameter } from './presentation-parameters';
import { requirePresentationOwner } from '../planning/presentation-ownership';
import { normalizeComponentSourceBindings } from './source-bindings';
import { planSourceDestructuring } from '../planning/source-destructuring';
import { lowerSourceDestructuring } from './source-destructuring';
import { scanRenderProps } from '../analysis/render-props';

function normalizeComponents(ctx: Ctx, programPath: ProgramPath): void {
  const normalizedParameters = lowerPrivateRowProps(
    ctx,
    programPath,
    planPrivateRowProps(ctx, programPath),
  );
  // Reanalyze normalized lexical bindings from the backend's explicit result.
  // The backend never publishes its positional ABI by mutating source props.
  for (const [name, parameters] of normalizedParameters) {
    ctx.componentProps.set(name, analyzeComponentProps(parameters));
  }
  lowerSourceDestructuring(
    ctx,
    planSourceDestructuring(
      ctx,
      programPath.node,
      refreshAstAnalysis(ctx, programPath.node),
      programPath,
    ),
  );
  refreshAstAnalysis(ctx, programPath.node);
  normalizeComponentSourceBindings(ctx);
  scanRefProps(ctx);
  scanRenderCallbacks(ctx);
  normalizeRenderFunctions(ctx);
  scanLocalDynamicComponentCandidates(ctx, programPath);
  scanRenderProps(ctx);
  normalizeComponentJsxValues(ctx);
  const dynamicTags = planDynamicTags(ctx);
  lowerDynamicTags(ctx, dynamicTags);
  recordDynamicTagPropModes(ctx, dynamicTags.propModes);
  lowerCalculatedListSources(ctx, planCalculatedListSources(ctx));
}

function validateComponents(ctx: Ctx): void {
  for (const [name] of ctx.comps) analyzeComponent(ctx, name);
}

function preparePresentation(ctx: Ctx): void {
  // Every ordinary component participates in the private presentation-policy
  // channel. This lets a Group policy cross source-less component boundaries
  // without making policy an authored prop. Only synchronous lightweight
  // rows omit the channel; resource-owning rows need their own read-local UI.
  for (const [name] of ctx.comps) {
    if (
      ctx.presentationOwners.has(name) ||
      ((ctx.listedSites.has(name) || ctx.linkedComponentRows.has(name)) &&
        !ctx.transparentSources.has(name) &&
        isListLightweightCandidate(ctx, name))
    )
      continue;
    allocatePresentationParameter(ctx, requirePresentationOwner(ctx, name, 'inherited'));
  }
}

function validateListPlacements(ctx: Ctx): void {
  const listedComponents = new Set([...ctx.listedSites.keys(), ...ctx.linkedComponentRows.keys()]);
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
}

/** DOM-only normalization and ABI rules at the shared coordinator's hook points. */
export const domAnalysisProfile: Pick<
  SemanticAnalysisProfile<Ctx>,
  'normalizeComponents' | 'validateComponents' | 'preparePresentation' | 'validateListPlacements'
> = { normalizeComponents, validateComponents, preparePresentation, validateListPlacements };

export function runAnalysis(ctx: Ctx, programPath: ProgramPath): void {
  runSemanticAnalysis(ctx, programPath, domAnalysisProfile);
}
