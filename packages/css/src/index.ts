export { css, style, vars, keyframes } from './api';
export { compileProgram, getCssText, clearRegistry, mountStyles } from './registry';

// compiler-facing: IR nodes, markers, analysis, and the classify/emit pipeline
export { bind, cond, when, isMarker, WHEN_KEY } from './grammar';
export { classify } from './classify';
export { emitProgram, emitKeyframes } from './emit';
export { hashString, stableStringify } from './hash';
export { analyzeStyleFn, CssAnalysisError } from './analyze';
export type {
  AnalyzeOptions,
  CssAnalysis,
  CssBinding,
  CssVariant,
  EstreeNode,
  FragmentResolver,
  ResolvedFragment,
  FragmentResolver,
  ResolvedFragment,
} from './analyze';
export type {
  Binding,
  Block,
  Decl,
  MapSlot,
  Prelude,
  StyleProgram,
  ValueExpr,
  VariantClass,
  WhenGroup,
} from './grammar';

export type {
  Angle,
  AtRuleKeys,
  Color,
  ContainerBlock,
  CustomPropertyKey,
  Length,
  MediaFeatures,
  NamedColor,
  Percentage,
  PseudoKey,
  RangeKey,
  SelectorKey,
  StyleObject,
  StyleProperties,
  StyleRef,
  StyledFn,
  SupportsBlock,
  Time,
  Value,
  ValueMap,
  VarRef,
} from './types';
export type { VarsResult } from './api';
