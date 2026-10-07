/** Shared preparation for linked manifests and final program emission. */
import {refreshAstAnalysis,type Ctx,type ProgramPath} from '../context';
import {planGroupPresentations} from '../planning/presentation-policy';
import {planReadReplays} from '../planning/read-replay';
import {planModuleSources} from '../planning/module-sources';
import {planBodylessFetchImports} from '../planning/fetch-encoding';
import {lowerBodylessFetchImports} from '../features/data-sources/fetch-encoding';
import { runAnalysis } from '../analysis';
import { normalizeComponentDeclarations } from '../components/declarations';
import { installLinkedDynamicComponentImports } from '../jsx/dynamic-tags';
import { normalizeConditionalJsxDirectives } from '../jsx/conditional-directives';
import { initializeGeneratedIdentifiers } from '../identifiers';
import { scanExternalReactiveImports } from '../external-reactivity';
import { analyzeRouterJsx } from '../router';
import { installCompilerIntrinsics } from '../intrinsics';
import {
  scanTransparentSourceImports,
  lowerReadReplays,
  lowerTransparentGroups,
  lowerModuleSourceDeclarations,
  rejectNonGetServerFunctionRenderCalls,
  scanEventSourceAssignments,
} from '../data-sources';

export function prepareProgramAnalysis(ctx: Ctx, programPath: ProgramPath): void {
  installCompilerIntrinsics(ctx, programPath);
  normalizeComponentDeclarations(programPath);
  installLinkedDynamicComponentImports(ctx, programPath);
  normalizeConditionalJsxDirectives(programPath);
  initializeGeneratedIdentifiers(ctx, programPath.node);
  scanExternalReactiveImports(ctx, programPath);
  scanTransparentSourceImports(ctx, programPath);
  let sourceAnalysis = refreshAstAnalysis(ctx, programPath.node);
  const bodylessFetches = ctx.dataRuntimePath === '@memoized-dom/data/internal'
    ? lowerBodylessFetchImports(programPath.node,
      planBodylessFetchImports(programPath.node, sourceAnalysis, ctx.transparentProviderFactories))
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
      bodylessFetches}, programPath);
  lowerModuleSourceDeclarations(ctx, programPath.node, moduleSources);
  analyzeRouterJsx(ctx, programPath);
  runAnalysis(ctx, programPath);
  rejectNonGetServerFunctionRenderCalls(ctx, programPath);
  scanEventSourceAssignments(ctx);
}
