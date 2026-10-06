/** Shared preparation for linked manifests and final program emission. */
import {refreshAstAnalysis,type Ctx,type ProgramPath} from '../context';
import {planGroupPresentations} from '../planning/presentation-policy';
import {planReadReplays} from '../planning/read-replay';
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
  scanAndLowerModuleSourceDeclarations,
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
  const reads = planReadReplays(programPath.node, sourceAnalysis, ctx.transparentReadFactories);
  lowerReadReplays(ctx, reads);
  // Refresh only when lowering introduced callbacks or lexical declarations.
  if (reads.length > 0) sourceAnalysis = refreshAstAnalysis(ctx, programPath.node);
  const presentations=planGroupPresentations(programPath.node,
    sourceAnalysis,ctx.transparentGroups,programPath);
  lowerTransparentGroups(ctx, programPath,presentations);
  scanAndLowerModuleSourceDeclarations(ctx, programPath);
  analyzeRouterJsx(ctx, programPath);
  runAnalysis(ctx, programPath);
  rejectNonGetServerFunctionRenderCalls(ctx, programPath);
  scanEventSourceAssignments(ctx);
}
