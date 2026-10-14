/** Native view/region emission from target-neutral component plans. */
import { createHash } from 'node:crypto';

import * as b from '../ast/factory';
import type * as t from '../ast/compiler-types';
import {
  cloneNode,
  type BaseNode,
  valueToNode,
} from '../ast';
import { isRenderPropReference } from '../analysis/render-prop-reference';
import type { CellEmissionContext } from '../cells';
import {
  callPropsFromObject,
  orderCallProps,
} from '../components/call-props';
import { runtimePropSlotCount } from '../components/props';
import { emitOrderedAttributes } from '../emission/attributes';
import {
  generatedIdentifier,
  md,
} from '../emission/identifiers';
import { planOrderedAttributes } from '../jsx/attributes';
import { hasComponentChildren } from '../jsx/children';
import type { PlannedComponent } from '../planning/component-render';

import { lowerNativeTemplate } from './template';
import type { NativeTemplatePlan } from './template-plan';

export function nativeEvaluation(plan: NativeTemplatePlan): t.Expression {
  return b.arrayExpression(plan.steps.flatMap((step) => {
    if (step.kind === 'region') {
      return [];
    }

    const value = step.kind === 'text'
      ? cloneNode(step.expression)
      : emitOrderedAttributes(step.plan);

    return [b.objectExpression([
      b.objectProperty(b.identifier('kind'), b.stringLiteral(step.kind)),
      b.objectProperty(b.identifier('source'), b.numericLiteral(step.source)),
      b.objectProperty(b.identifier('value'), value),
    ])];
  }));
}

/** Wire templates are immutable, so their key includes the native topology. */
export function withTemplateRevision(
  plan: NativeTemplatePlan,
): NativeTemplatePlan {
  const revision = createHash('sha256')
    .update(JSON.stringify(plan.template.nodes))
    .digest('hex');

  return {
    ...plan,
    template: {
      ...plan.template,
      key: `${plan.template.key}:${revision}`,
    },
  };
}

export interface NativeViewEmissionInputs {
  readonly ctx: CellEmissionContext;
  readonly moduleId: string;
  readonly component: PlannedComponent;
  readonly nativeId: t.Identifier;
  readonly conditionCount: { value: number };
  readonly slotCount: { value: number };
  readonly prelude: t.Statement[];
  readonly fail: (message: string, at: t.Node) => never;
}

/**
 * Emit one view factory from a shared template plan. Recursive calls lower
 * conditional branch bodies with the same component sources and identities.
 */
export function emitNativeView(
  inputs: NativeViewEmissionInputs,
  plan: NativeTemplatePlan,
  viewFrame: t.Identifier,
  evaluate: t.ArrowFunctionExpression,
): t.CallExpression {
  const {
    ctx,
    moduleId,
    component,
    nativeId,
    conditionCount,
    fail,
  } = inputs;
  const childCounts = new Map<string, number>();
  let forwardedSlotCount = 0;
  const children = plan.steps.flatMap((step): t.Expression[] => {
    if (step.kind !== 'region') {
      return [];
    }

    if (step.content.type === 'condition') {
      const site = component.regionShapes.conditionalFor(step.content.expression);
      const segment = `when${conditionCount.value++}`;
      const childFrame = generatedIdentifier(ctx, 'conditionalFrame');
      const factories = site.branches.map((branch, index): t.Expression => {
        if (branch === null) {
          return b.nullLiteral();
        }

        const branchPlan = withTemplateRevision(lowerNativeTemplate({
          key: `${moduleId}#${component.name}/${segment}[${index}]`,
          jsx: branch,
          expressionSources: component.expressionSources,
          isForwarded: expression => isRenderPropReference(
            ctx, component.name, expression as unknown as BaseNode,
          ),
          fail,
        }));

        validateNativeTemplatePlan(branchPlan, branch, fail);

        const branchFrame = generatedIdentifier(ctx, 'branchFrame');

        return b.arrowFunctionExpression(
          [branchFrame],
          emitNativeView(
            inputs,
            branchPlan,
            branchFrame,
            b.arrowFunctionExpression([], nativeEvaluation(branchPlan)),
          ),
        );
      });
      const create = b.arrowFunctionExpression(
        [childFrame],
        b.callExpression(
          b.memberExpression(cloneNode(nativeId), b.identifier('createConditional')),
          [
            cloneNode(childFrame),
            b.arrowFunctionExpression([], cloneNode(site.pickExpr)),
            b.arrayExpression(factories),
          ],
        ),
      );

      return [
        b.callExpression(
          b.memberExpression(cloneNode(nativeId), b.identifier('child')),
          [
            b.stringLiteral(segment),
            b.numericLiteral(step.source),
            create,
          ],
        ),
      ];
    }

    if (step.content.type === 'slot') {
      const seen = forwardedSlotCount++;
      const segment = seen === 0 ? 'slot' : `slot[${seen}]`;
      const childFrame = generatedIdentifier(ctx, 'slotFrame');
      const create = b.arrowFunctionExpression(
        [childFrame],
        b.callExpression(
          b.memberExpression(cloneNode(nativeId), b.identifier('createSlot')),
          [
            cloneNode(childFrame),
            b.arrowFunctionExpression([], cloneNode(step.content.expression)),
          ],
        ),
      );

      return [
        b.callExpression(
          b.memberExpression(cloneNode(nativeId), b.identifier('child')),
          [
            b.stringLiteral(segment),
            b.numericLiteral(step.source),
            create,
          ],
        ),
      ];
    }

    if (step.content.type !== 'component') {
      throw new Error('Structural capability must be checked before emission');
    }

    const element = step.content.node;
    const opening = element.openingElement;

    if (!b.isJSXIdentifier(opening.name)) {
      fail(
        'Member and dynamic component tags require shared dynamic-tag emission',
        opening.name,
      );
    }

    const tag = (opening.name as t.JSXIdentifier).name;

    if (!ctx.compPaths.has(tag) && !ctx.importedComponents.has(tag)) {
      fail(`Component <${tag}> is not resolved by the application graph`, opening.name);
    }

    const seen = childCounts.get(tag) ?? 0;
    childCounts.set(tag, seen + 1);
    const segment = seen === 0 ? tag : `${tag}[${seen}]`;

    const attributes = planOrderedAttributes(opening.attributes, {
      skipKey: true,
      fail: message => fail(message, opening),
    });
    const targetProps = ctx.componentProps.get(tag)!;
    const authoredChildren = hasComponentChildren(element.children);
    let childrenFactory: t.Identifier | null = null;

    if (authoredChildren) {
      if (attributes.entries.some((entry) =>
        entry.type === 'attribute' && entry.name === 'children')) {
        fail(`Component <${tag}> cannot use both a children prop and nested JSX children`, element);
      }

      const slotIndex = inputs.slotCount.value++;
      const slotPlan = withTemplateRevision(lowerNativeTemplate({
        key: `${moduleId}#${component.name}/$slot[${slotIndex}]`,
        jsx: b.jsxFragment(
          b.jsxOpeningFragment(),
          b.jsxClosingFragment(),
          element.children.map(child => cloneNode(child)),
        ),
        expressionSources: component.expressionSources,
        isForwarded: expression => isRenderPropReference(
          ctx, component.name, expression as unknown as BaseNode,
        ),
        fail,
      }));

      validateNativeTemplatePlan(slotPlan, element, fail);

      childrenFactory = generatedIdentifier(ctx, 'children');
      const slotFrame = generatedIdentifier(ctx, 'childrenFrame');

      inputs.prelude.push(
        b.variableDeclaration('const', [
          b.variableDeclarator(
            cloneNode(childrenFactory),
            b.arrowFunctionExpression(
              [slotFrame],
              emitNativeView(
                inputs,
                slotPlan,
                slotFrame,
                b.arrowFunctionExpression([], nativeEvaluation(slotPlan)),
              ),
            ),
          ),
        ]),
      );
    }

    const spreads = attributes.entries.some(entry => entry.type === 'spread');
    const orderedAttributes = emitOrderedAttributes(attributes);

    if (childrenFactory !== null) {
      orderedAttributes.properties.push(
        b.objectProperty(
          b.identifier('children'),
          cloneNode(childrenFactory),
        ),
      );
    }

    const arguments_ = spreads
      ? callPropsFromObject(ctx, tag, orderedAttributes)
      : orderCallProps(
          ctx,
          tag,
          [
            ...attributes.entries.map((entry) => {
              if (entry.type === 'spread') {
                throw new Error('Spread entries are handled by the object path');
              }

              return { name: entry.name, value: cloneNode(entry.value) };
            }),
            ...(childrenFactory === null
              ? []
              : [{ name: 'children', value: cloneNode(childrenFactory) }]),
          ],
        );
    const childFrame = generatedIdentifier(ctx, 'childFrame');
    const targetPropSlots = runtimePropSlotCount(targetProps);
    const boxedArguments = b.arrayExpression(
      arguments_.map((argument) => cloneNode(argument)),
    );
    const create = b.arrowFunctionExpression(
      [childFrame],
      b.callExpression(b.identifier(tag), [
        cloneNode(childFrame),
        ...(targetPropSlots > 0 ? [boxedArguments] : []),
      ]),
    );
    const childId = b.binaryExpression(
      '+',
      // A branch range has an extra wire owner (`$content`), while prop replay
      // continues to address the stable semantic component ID.
      b.callExpression(
        b.memberExpression(cloneNode(nativeId), b.identifier('frameId')),
        [cloneNode(viewFrame)],
      ),
      b.stringLiteral(`/${segment}`),
    );
    const update = targetPropSlots === 0
      ? null
      : b.arrowFunctionExpression(
          [],
          b.callExpression(md(ctx, 'setProps'), [
            childId,
            b.arrayExpression(
              arguments_.map((argument) => cloneNode(argument)),
            ),
          ]),
        );

    return [
      b.callExpression(
        b.memberExpression(cloneNode(nativeId), b.identifier('child')),
        [
          b.stringLiteral(segment),
          b.numericLiteral(step.source),
          create,
          ...(update === null ? [] : [update]),
        ],
      ),
    ];
  });

  return b.callExpression(
    b.memberExpression(cloneNode(nativeId), b.identifier('createView')),
    [
      cloneNode(viewFrame),
      valueToNode(plan.template) as t.Expression,
      evaluate,
      b.arrayExpression(children),
    ],
  );
}

export function validateNativeTemplatePlan(
  plan: NativeTemplatePlan,
  jsx: t.Node,
  fail: (message: string, at: t.Node) => never,
): void {
  if (plan.refs.length > 0) {
    fail('Refs require native handle capability emission', jsx);
  }

  for (const event of plan.events) {
    if (event.name !== 'onClick' && event.name !== 'onClickCapture') {
      fail(`Event ${event.name} requires native platform dispatch integration`, jsx);
    }
  }

  for (const step of plan.steps) {
    if (
      step.kind === 'region' &&
      step.content.type !== 'component' &&
      step.content.type !== 'condition' &&
      step.content.type !== 'slot'
    ) {
      fail('Lists require structural replay emission', jsx);
    }
  }
}
