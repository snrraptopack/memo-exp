/**
 * List-method optimization candidates, not a supported-method whitelist.
 *
 * These labels describe possible native Array behavior, never a proven call
 * outcome. Overrides, callbacks, argument evaluation, and receiver provenance
 * still require analysis. Unknown names retain existing conservative routing;
 * this table must not be used to reject authored methods or infer purity.
 *
 * Compiler-owned JSX map enables a specialization. Push candidates may extend
 * the closed-record proof used for targeted content writes, but calls retain
 * content-safe reconciliation because a property name alone cannot prove
 * native Array.prototype behavior. Other candidates likewise retain ordinary
 * reconciliation. Property writes (including length and indexed replacement)
 * are not method calls and do not belong here.
 */
export const LIST_METHOD_OPTIMIZATIONS: Readonly<Record<string,
  'render' | 'append' | 'truncate' | 'positional' | 'reorder' | undefined
>> = {
  map: 'render',
  push: 'append',
  pop: 'truncate',
  unshift: 'positional',
  shift: 'positional',
  splice: 'positional',
  reverse: 'reorder',
  sort: 'reorder',
  fill: 'positional',
  copyWithin: 'positional',
};
