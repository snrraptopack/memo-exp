/**
 * Desktop build support, separate from the default browser compiler entry.
 * Template lowering and the first fixed-host/module-cell execution phase.
 * Application authoring continues to use the runtime's ordinary mount().
 */
export { lowerNativeTemplate } from './desktop/template';
export { compileDesktop, type DesktopCompileOptions } from './desktop/compile';
export type {
  HostAttributeStep,
  HostEvaluationStep,
  HostRegionStep,
  HostTextStep,
  NativeSourceTemplate,
  NativeTemplateInputs,
  NativeTemplatePlan,
} from './desktop/template-plan';
