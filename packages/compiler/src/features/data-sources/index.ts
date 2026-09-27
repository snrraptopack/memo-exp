/** Public compiler-pass surface for the transparent data-source feature. */
export {
  normalizeTransparentSourceDestructuring,
  scanTransparentSourceImports,
} from './discovery';
export { addReadReplayFactories } from './read-replay';
export {
  registerTransparentSourceRoots,
  scanAndLowerModuleSourceDeclarations,
} from './module-sources';
export {
  rejectNonGetServerFunctionRenderCalls,
  scanEventSourceAssignments,
  scanTransparentSourceBindings,
} from './component-sources';
export {
  transparentCallPolicyArgument,
  transparentBoundaryPolicyArgument,
  transparentSourceMounts,
} from './policy-arguments';
export {
  preparationRead,
  registerTransparentDataSite,
  subscribeTransparentStructuralSite,
  transparentExpressionSources,
} from './subscriptions';
export { isImplicitPolicyProp, transparentPolicyRenderer } from './automatic-sites';
export { rewriteTransparentDataReads } from './read-rewriting';
export { lowerTransparentGroups } from './group-lowering';
export { atomicSitePolicy } from './atomic-sites';
