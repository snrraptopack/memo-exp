/**
 * Desktop build support, separate from the default browser compiler entry.
 * This first boundary lowers already analyzed JSX; full JS emission follows.
 * Application authoring continues to use the runtime's ordinary mount().
 */
export { lowerNativeTemplate } from './desktop/template';
export type {
  HostAttributeStep,
  HostEvaluationStep,
  HostRegionStep,
  HostTextStep,
  NativeSourceTemplate,
  NativeTemplateInputs,
  NativeTemplatePlan,
} from './desktop/template-plan';
