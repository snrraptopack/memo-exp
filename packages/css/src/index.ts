export { css, style, vars, keyframes } from './api';
export { getCssText, clearRegistry, mountStyles } from './registry';

// compiler-facing: IR nodes, markers, and the classify/emit pipeline
export { param, cond, isMarker } from './grammar';
export { classify } from './classify';
export { emitProgram } from './emit';
export type {
  Block,
  Decl,
  MapSlot,
  ParamBinding,
  Prelude,
  StyleProgram,
  ValueExpr,
  VariantClass,
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
