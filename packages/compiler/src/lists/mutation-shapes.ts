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
 * native Array.prototype behavior. Returned-array candidates may skip retained
 * content only through the closed owner-source proof and its runtime guards.
 * Property writes (including length and indexed replacement)
 * are not method calls and do not belong here.
 */
export interface ListMethodOptimization {
  readonly kind: 'render' | 'append' | 'truncate' | 'positional' | 'reorder' | 'copy' | 'select' | 'combine';
  /** Returned-array behavior eligible for an independent closed-source proof. */
  readonly result?: 'copy' | 'filter' | 'map' | 'concat';
  readonly maxArguments?: number;
  readonly guards?: readonly ('species' | 'spreadable')[];
}

export const LIST_METHOD_OPTIMIZATIONS: Readonly<Record<string, ListMethodOptimization | undefined>> = {
  map: { kind: 'render', result: 'map', guards: ['species'] },
  push: { kind: 'append' },
  pop: { kind: 'truncate' },
  unshift: { kind: 'positional' },
  shift: { kind: 'positional' },
  splice: { kind: 'positional' },
  reverse: { kind: 'reorder' },
  sort: { kind: 'reorder' },
  fill: { kind: 'positional' },
  copyWithin: { kind: 'positional' },
  slice: { kind: 'copy', result: 'copy', maxArguments: 2, guards: ['species'] },
  filter: { kind: 'select', result: 'filter', guards: ['species'] },
  concat: { kind: 'combine', result: 'concat', guards: ['species', 'spreadable'] },
  toReversed: { kind: 'reorder', result: 'copy', maxArguments: 0 },
};
