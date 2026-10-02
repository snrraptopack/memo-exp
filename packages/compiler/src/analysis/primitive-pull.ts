import { identifierName, type BaseNode, type Binding } from '../ast';
import { isPlainScalarValue } from './plain-scalar';

export interface ScalarReadFact {
  readonly supported: boolean;
  readonly reads: readonly Binding[];
}

export interface PrimitiveWriteFact {
  /** Null denotes synchronous owner initialization, requiring no publication. */
  readonly execution: BaseNode | null;
  readonly completionSafe: boolean;
  readonly completionReads: readonly Binding[];
  readonly value: ScalarReadFact;
}

export interface PrimitiveBindingFact {
  readonly initializer: ScalarReadFact;
  readonly writes: readonly PrimitiveWriteFact[];
}

export interface ComponentPullFacts {
  readonly independentFor: (expression: BaseNode) => boolean;
}

export interface ComponentPullPlan {
  /** Complete only after this owner's handlers/callbacks have been lowered. */
  readonly finalize: (isInstrumented: (execution: BaseNode) => boolean) => ComponentPullFacts;
}

/** Convert an expression to primitive grammar and lexical dependencies once. */
export function scalarReadFact(
  expression: BaseNode | null,
  resolve: (node: BaseNode, name: string) => Binding | undefined,
): ScalarReadFact {
  const reads = new Set<Binding>();
  const supported = isPlainScalarValue(expression, node => {
    const binding = resolve(node, identifierName(node)!);
    if (binding === undefined) return false;
    reads.add(binding);
    return true;
  });
  return { supported, reads: [...reads] };
}

/** Solve authored primitive facts using an explicit snapshot of publication. */
export function createPrimitivePullPlan(
  bindings: ReadonlyMap<Binding, PrimitiveBindingFact>,
  dynamicScope: boolean,
  resolve: (node: BaseNode, name: string) => Binding | undefined,
): ComponentPullPlan {
  return { finalize(isInstrumented) {
    const instrumented = new Set<BaseNode>();
    for (const fact of bindings.values()) for (const write of fact.writes) {
      if (write.execution !== null && isInstrumented(write.execution)) instrumented.add(write.execution);
    }
    const known = new Map<Binding, boolean>();
    const visiting = new Set<Binding>();
    const scalar = (fact: ScalarReadFact): boolean => fact.supported && fact.reads.every(primitive);
    const primitive = (binding: Binding): boolean => {
      const cached = known.get(binding);
      if (cached !== undefined) return cached;
      const fact = bindings.get(binding);
      if (fact === undefined || visiting.has(binding)) return false;
      visiting.add(binding);
      let valid = scalar(fact.initializer);
      for (const write of fact.writes) {
        if (!valid) break;
        if (!write.completionSafe || write.execution !== null &&
            (!instrumented.has(write.execution) || write.completionReads.some(read => read !== binding && !primitive(read)))) {
          valid = false;
        } else valid = scalar(write.value);
      }
      visiting.delete(binding);
      known.set(binding, valid);
      return valid;
    };
    return { independentFor: expression => !dynamicScope && scalar(scalarReadFact(expression, resolve)) };
  } };
}
