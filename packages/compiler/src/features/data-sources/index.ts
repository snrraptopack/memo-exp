/** Public compiler-pass surface for the transparent data-source feature. */
export {
  normalizeTransparentSourceDestructuring,
  scanTransparentSourceImports,
} from './discovery';
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
  transparentSourceMounts,
} from './policy-arguments';
export {
  registerTransparentDataSite,
  subscribeTransparentStructuralSite,
  transparentExpressionSources,
} from './subscriptions';
export { transparentPolicyRenderer } from './automatic-sites';
export { rewriteTransparentDataReads } from './read-rewriting';
export { lowerTransparentGroups } from './group-lowering';
