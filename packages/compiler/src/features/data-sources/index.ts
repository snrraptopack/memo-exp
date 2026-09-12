/** Public compiler-pass surface for the transparent data-source feature. */
export {
  rejectTransparentSourceDestructuring,
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
