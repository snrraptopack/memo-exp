/** DOM preparation coordinates source analysis with runtime-producing normalization. */
import { refreshAstAnalysis, type ProgramPath } from '../context';
import { type DomContext as Ctx } from './context';
import { planGroupPresentations } from '../planning/presentation-policy';
import { planReadReplays } from '../planning/read-replay';
import { planModuleSources, recordModuleSourceBindings } from '../planning/module-sources';
import { planBodylessFetchImports } from '../planning/fetch-encoding';
import { lowerBodylessFetchImports } from './fetch-encoding';
import { runAnalysis } from './analyze';
import {allocateInstanceReasons} from './instance-reasons';
import { analyzeDomOnlyRows } from './row-eligibility';
import { normalizeComponentDeclarations } from '../components/declarations';
import { lowerLinkedDynamicComponentImports } from './dynamic-tags';
import { recordLinkedDynamicComponentBindings } from '../analysis/dynamic-imports';
import { normalizeConditionalJsxDirectives } from '../jsx/conditional-directives';
import { initializeGeneratedIdentifiers } from './identifiers';
import {scanExternalReactiveImports} from '../analysis/external-reactivity';
import {allocateExternalSubscriptions} from './external-reactivity';
import { lowerRouterJsx } from './router';
import {planRouterJsx} from '../analysis/routes';
import { installCompilerIntrinsics } from './intrinsics';
import { scanTransparentSourceImports } from '../analysis/transparent-imports';
import { lowerReadReplays } from './read-replay';
import { lowerTransparentGroups } from './group-lowering';
import { lowerModuleSourceDeclarations } from './source-declarations';
import { rejectNonGetServerFunctionRenderCalls, scanEventSourceAssignments } from '../analysis/transparent-sources';

export function prepareProgramAnalysis(ctx: Ctx, programPath: ProgramPath): void {
  installCompilerIntrinsics(ctx, programPath);
  normalizeComponentDeclarations(programPath);
  const dynamicImports = lowerLinkedDynamicComponentImports(ctx, programPath);
  recordLinkedDynamicComponentBindings(ctx, dynamicImports);
  ctx.emission.header.push(...dynamicImports.imports);
  normalizeConditionalJsxDirectives(programPath);
  initializeGeneratedIdentifiers(ctx, programPath.node);
  scanExternalReactiveImports(ctx, programPath);
  allocateExternalSubscriptions(ctx);
  scanTransparentSourceImports(ctx, programPath);
  let sourceAnalysis = refreshAstAnalysis(ctx, programPath.node);
  const bodylessFetches = ctx.dataRuntimePath === '@memoized-dom/data/internal'
    ? lowerBodylessFetchImports(programPath.node,
      planBodylessFetchImports(programPath.node, sourceAnalysis, ctx.transparentProviderFactories), ctx.dataDelivery)
    : new Set<string>();
  if (bodylessFetches.size > 0) sourceAnalysis = refreshAstAnalysis(ctx, programPath.node);
  const reads = planReadReplays(programPath.node, sourceAnalysis, ctx.transparentReadFactories);
  lowerReadReplays(ctx, reads);
  // Refresh only when lowering introduced callbacks or lexical declarations.
  if (reads.length > 0) sourceAnalysis = refreshAstAnalysis(ctx, programPath.node);
  const presentations=planGroupPresentations(programPath.node,
    sourceAnalysis,ctx.transparentGroups,programPath);
  lowerTransparentGroups(ctx, programPath,presentations);
  const moduleSources = planModuleSources(programPath.node, refreshAstAnalysis(ctx, programPath.node), ctx.moduleId,
    {sources: ctx.transparentSourceFactories, forms: ctx.transparentFormFactories, reads: ctx.transparentReadFactories,
      bodylessFetches, clientOnly:ctx.dataDelivery === 'client'}, programPath);
  recordModuleSourceBindings(ctx, moduleSources);
  lowerModuleSourceDeclarations(ctx, programPath.node, moduleSources);
  lowerRouterJsx(ctx,planRouterJsx(programPath,ctx.moduleId,ctx.linkedRoutes));
  runAnalysis(ctx, programPath);
  allocateInstanceReasons(ctx);
  analyzeDomOnlyRows(ctx);
  rejectNonGetServerFunctionRenderCalls(ctx, programPath);
  scanEventSourceAssignments(ctx);
}
