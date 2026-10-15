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
import { componentPatterns } from '../analysis/component-graph';
import { canonicalStateKey } from '../context';
import { nodeHasJsx } from '../context/ast';
import type { CellEmissionContext } from '../cells';
import {
  callPropsFromObject,
  orderCallProps,
} from '../components/call-props';
import { runtimePropSlotCount } from '../components/props';
import { emitOrderedAttributes, mapStaticAttributeValues } from '../emission/attributes';
import {
  generatedIdentifier,
  md,
} from '../emission/identifiers';
import { planOrderedAttributes } from '../jsx/attributes';
import { hasComponentChildren, type JsxChild } from '../jsx/children';
import type { PlannedComponent } from '../planning/component-render';
import type { MapSite } from '../lists/map-site';

import { lowerNativeTemplate } from './template';
import { emitNativeList } from './list-emission';
import { validateNativeEventWrites } from './events';
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
  readonly listPrefixes: Map<string, number>;
  readonly parentRow?: Pick<MapSite, 'itemParam' | 'sourceKey' | 'sourceLocal' | 'keyExpr'>;
  readonly prelude: t.Statement[];
  readonly slotReplayReaders: Map<string, Set<string>>;
  readonly fail: (message: string, at: t.Node) => never;
}

/**
 * Nested children and JSX-valued props share one lazy caller-closure factory.
 * Hoisting the factory declaration preserves its identity during prop replay;
 * authored content expressions still run only when the callee mounts/updates it.
 */
function emitContentFactory(
  inputs: NativeViewEmissionInputs,
  children: readonly JsxChild[],
  at: t.Node,
  inSvg: boolean,
): t.Identifier {
  const { ctx, moduleId, component, fail } = inputs;

  // Shared condition facts address lexical regions. Native slots retain their
  // ranges below the receiving controller, so route those source writes through
  // the caller's existing update traversal as well. This is a presentation
  // destination projection of shared facts, not a dependency scan or resolver.
  for (const site of ctx.condReads.values()) {
    if (site.owner !== component.name) {
      continue;
    }

    for (const source of site.vars) {
      const key = canonicalStateKey(ctx, source);
      let destinations = inputs.slotReplayReaders.get(key);

      if (destinations === undefined) {
        destinations = new Set();
        inputs.slotReplayReaders.set(key, destinations);
      }

      for (const owner of componentPatterns(ctx, component.name)) {
        destinations.add(owner);
      }
    }
  }

  const slotIndex = inputs.slotCount.value++;
  const slotPlan = withTemplateRevision(lowerNativeTemplate({
    key: `${moduleId}#${component.name}/$slot[${slotIndex}]`,
    jsx: b.jsxFragment(
      b.jsxOpeningFragment(),
      b.jsxClosingFragment(),
      children.map(child => cloneNode(child)),
    ),
    expressionSources: component.expressionSources,
    isForwarded: expression => isRenderPropReference(
      ctx, component.name, expression as unknown as BaseNode,
    ),
    inSvg,
    fail,
  }));

  validateNativeTemplatePlan(slotPlan, at, fail);

  const factory = generatedIdentifier(ctx, 'content');
  const slotFrame = generatedIdentifier(ctx, 'contentFrame');
  const create = emitNativeView(
    inputs,
    slotPlan,
    slotFrame,
    b.arrowFunctionExpression([], nativeEvaluation(slotPlan)),
  );

  inputs.prelude.push(b.variableDeclaration('const', [
    b.variableDeclarator(
      cloneNode(factory),
      b.arrowFunctionExpression([slotFrame], create),
    ),
  ]));

  return factory;
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

  validateNativeEventWrites(plan, component.callbacks, inputs.parentRow, fail);

  const childCounts = new Map<string, number>();
  let forwardedSlotCount = 0;
  const children = plan.steps.flatMap((step): t.Expression[] => {
    if (step.kind !== 'region') {
      return [];
    }

    if (step.content.type === 'list') {
      return [emitNativeList(inputs, { ...step, content: step.content }, {
        evaluate: nativeEvaluation,
        create: emitNativeView,
        lower(jsx, key, inSvg) {
          const rowPlan = withTemplateRevision(lowerNativeTemplate({
            key,
            jsx,
            inSvg,
            expressionSources: component.expressionSources,
            isForwarded: expression => isRenderPropReference(
              ctx, component.name, expression as unknown as BaseNode,
            ),
            fail,
          }));
          validateNativeTemplatePlan(rowPlan, jsx, fail);
          return rowPlan;
        },
      })];
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

    const authoredAttributes = planOrderedAttributes(opening.attributes, {
      skipKey: true,
      fail: message => fail(message, opening),
    });
    const targetProps = ctx.componentProps.get(tag)!;
    const authoredChildren = hasComponentChildren(element.children);
    let childrenFactory: t.Identifier | null = null;

    if (authoredChildren) {
      if (authoredAttributes.entries.some((entry) =>
        entry.type === 'attribute' && entry.name === 'children')) {
        fail(`Component <${tag}> cannot use both a children prop and nested JSX children`, element);
      }

      childrenFactory = emitContentFactory(
        inputs, element.children, element, step.inSvg,
      );
    }

    const prepareValue = (name: string, value: t.Expression): t.Expression => {
      if (!nodeHasJsx(value)) {
        return value;
      }

      if (targetProps.renderCallbacks.includes(name)) {
        fail('Render callbacks require shared callback presentation emission', value);
      }

      if (!targetProps.renderProps.includes(name)) {
        fail(`JSX prop '${name}' on <${tag}> is not rendered by the callee`, value);
      }

      const content = b.isJSXElement(value) || b.isJSXFragment(value)
        ? [value]
        : [b.jsxExpressionContainer(value)];

      return emitContentFactory(inputs, content, value, step.inSvg);
    };
    const attributes = {
      ...authoredAttributes,
      entries: authoredAttributes.entries.map(entry => ({
        ...entry,
        value: entry.type === 'spread'
          ? mapStaticAttributeValues(entry.value, prepareValue, property => {
              if (nodeHasJsx(property)) {
                fail('JSX spread values require static data-property names', property);
              }
            })
          : prepareValue(entry.name, entry.value),
      })),
    };

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

    const propObject = spreads ? generatedIdentifier(ctx, 'callProps') : null;
    const arguments_ = propObject !== null
      ? callPropsFromObject(ctx, tag, propObject)
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
    const argumentsArray = b.arrayExpression(
      arguments_.map((argument) => cloneNode(argument)),
    );
    const boxedArguments = propObject === null
      ? argumentsArray
      : b.callExpression(b.arrowFunctionExpression([], b.blockStatement([
          // Positional extraction must read one already-evaluated object, not
          // replay a spread/getter/call separately for each declared parameter.
          b.variableDeclaration('const', [
            b.variableDeclarator(cloneNode(propObject), orderedAttributes),
          ]),
          b.returnStatement(argumentsArray),
        ])), []);
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
            cloneNode(boxedArguments),
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

}
