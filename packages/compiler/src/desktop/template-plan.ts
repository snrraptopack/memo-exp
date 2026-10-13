/** Native addresses and evaluation order around shared source plans. */
import type * as t from '../ast/compiler-types';
import type { ComponentExpressionSources } from '../analysis/expression-sources';
import type { DirectChildPlan, JsxNode } from '../jsx/children';
import type { OrderedAttributePlan } from '../jsx/attributes';

export interface TemplateElementName {
  readonly namespace: string;
  readonly local: string;
}

/** Serializable projection consumed by the native document template registry. */
export interface NativeSourceTemplate {
  readonly key: string;
  readonly nodes: readonly {
    readonly parent: number | null;
    readonly node:
      | {
          readonly kind: 'element';
          readonly name: TemplateElementName;
          readonly attributes: readonly [];
        }
      | { readonly kind: 'text' | 'comment'; readonly value: string };
  }[];
}

export interface HostAttributeStep {
  readonly kind: 'attributes';
  readonly source: number;
  /** Keep spreads, refs and events in their original evaluation positions. */
  readonly plan: OrderedAttributePlan;
  readonly sources: readonly (readonly string[] | null)[];
}

export interface HostTextStep {
  readonly kind: 'text';
  readonly source: number;
  readonly expression: t.Expression;
  /** Existing source facts: [] is exact/no sources; null is conservative. */
  readonly sources: readonly string[] | null;
}

export type RegionChildPlan = Exclude<DirectChildPlan, { type: 'text' | 'node' }>;

export type HostRegionStep = {
  readonly kind: 'region';
  /** One non-layout comment anchors native insertion before the next sibling. */
  readonly source: number;
  readonly inSvg: boolean;
  readonly content:
    | { readonly type: 'component'; readonly node: t.JSXElement }
    | RegionChildPlan;
};

export type HostEvaluationStep = HostAttributeStep | HostTextStep | HostRegionStep;

export interface ExplicitHostEvent {
  readonly source: number;
  readonly entry: number;
  /** Authored event spelling; dispatch/cancellation belong to the event adapter. */
  readonly name: string;
}

export interface NativeTemplatePlan {
  readonly template: NativeSourceTemplate;
  /** Attributes precede children; sibling work retains authored source order. */
  readonly steps: readonly HostEvaluationStep[];
  readonly events: readonly ExplicitHostEvent[];
  readonly refs: readonly { readonly source: number; readonly entry: number }[];
}

export interface NativeTemplateInputs {
  readonly key: string;
  readonly jsx: JsxNode;
  readonly expressionSources: ComponentExpressionSources;
  /** Supplied by shared component/render-prop analysis, never guessed here. */
  readonly isForwarded: (expression: t.Expression) => boolean;
  /** Inherited placement of a component inside an SVG parent. */
  readonly inSvg?: boolean;
  readonly fail: (message: string, at: t.Node) => never;
}
