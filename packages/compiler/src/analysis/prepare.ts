/** Shared preparation for linked manifests and final program emission. */
import type { Ctx, ProgramPath } from '../context';
import { runAnalysis } from '../analysis';
import { normalizeComponentDeclarations } from '../components/declarations';
import { installLinkedDynamicComponentImports } from '../jsx/dynamic-tags';
import { normalizeConditionalJsxDirectives } from '../jsx/conditional-directives';
import { initializeGeneratedIdentifiers } from '../identifiers';
import { scanExternalReactiveImports } from '../external-reactivity';
import { analyzeRouterJsx } from '../router';
import { assimilateReactSource, unwrapReactComponentWrappers } from '../react/assimilation';
import { normalizeNamedReexports } from '../linking/reexports';
import {
  scanTransparentSourceImports,
  lowerTransparentGroups,
  scanAndLowerModuleSourceDeclarations,
  rejectNonGetServerFunctionRenderCalls,
  scanEventSourceAssignments,
} from '../data-sources';

export function prepareProgramAnalysis(ctx: Ctx, programPath: ProgramPath): void {
  normalizeNamedReexports(programPath.node);
  unwrapReactComponentWrappers(programPath);
  normalizeComponentDeclarations(programPath);
  assimilateReactSource(programPath);
  installLinkedDynamicComponentImports(ctx, programPath);
  normalizeConditionalJsxDirectives(programPath);
  initializeGeneratedIdentifiers(ctx, programPath.node);
  scanExternalReactiveImports(ctx, programPath);
  scanTransparentSourceImports(ctx, programPath);
  lowerTransparentGroups(ctx, programPath);
  scanAndLowerModuleSourceDeclarations(ctx, programPath);
  analyzeRouterJsx(ctx, programPath);
  runAnalysis(ctx, programPath);
  rejectNonGetServerFunctionRenderCalls(ctx, programPath);
  scanEventSourceAssignments(ctx);
}
