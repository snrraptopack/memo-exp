/** Public compiler-pass surface for the transparent data-source feature. */
export {
  normalizeTransparentSourceDestructuring,
  scanTransparentSourceImports,
} from './discovery';
export { lowerReadReplays } from './read-replay';
export {
  registerTransparentSourceRoots,
  lowerModuleSourceDeclarations,
} from './module-sources';
export {
  rejectNonGetServerFunctionRenderCalls,
  scanEventSourceAssignments,
  scanTransparentSourceBindings,
} from './component-sources';
export { rewriteTransparentDataReads } from './read-rewriting';
export { lowerTransparentGroups } from './group-lowering';
export { atomicSitePolicy } from './atomic-sites';
