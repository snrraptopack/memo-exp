/** Component-call policy propagation and source ownership emission. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {
  cloneNode,
  isValidIdentifier,
} from '../../ast';
import {
  type Ctx,
  type TransparentPresentationComponent,
  type TransparentPresentationPolicy,
} from '../../context';
import { orderCallProps } from '../../components/calls';
import { generatedIdentifier, md, mdd } from '../../identifiers';

function policyComponentRenderer(
  ctx: Ctx,
  presentation: string | TransparentPresentationComponent,
  kind: 'pending' | 'error',
): t.ArrowFunctionExpression {
  const component = typeof presentation === 'string'
    ? presentation
    : presentation.component;
  const id = generatedIdentifier(ctx, 'dataPolicyId');
  const parent = generatedIdentifier(ctx, 'dataPolicyParent');
  const error = generatedIdentifier(ctx, 'dataPolicyError');
  const retry = generatedIdentifier(ctx, 'dataPolicyRetry');
  const entries = kind === 'error'
    ? [
        { name: 'error', value: cloneNode(error) as t.Expression },
        { name: 'retry', value: cloneNode(retry) as t.Expression },
      ]
    : [];
  if (typeof presentation !== 'string') {
    entries.push(...presentation.props.map(({ name, value }) => ({
      name,
      value: cloneNode(value, true),
    })));
  }
  const props = orderCallProps(ctx, component, entries);
  return astFactory.arrowFunctionExpression(
    [
      cloneNode(id),
      cloneNode(parent),
      ...(kind === 'error' ? [cloneNode(error), cloneNode(retry)] : []),
    ],
    astFactory.callExpression(astFactory.identifier(component), [
      cloneNode(id),
      cloneNode(parent),
      ...(props.length > 0 ? [astFactory.arrayExpression(props)] : []),
    ]),
  );
}

function fixedPolicyExpression(
  ctx: Ctx,
  policy: TransparentPresentationPolicy,
): t.ObjectExpression {
  return astFactory.objectExpression([
    astFactory.objectProperty(
      astFactory.identifier('pending'),
      policyComponentRenderer(ctx, policy.pending, 'pending'),
    ),
    astFactory.objectProperty(
      astFactory.identifier('error'),
      policyComponentRenderer(ctx, policy.error, 'error'),
    ),
  ]);
}

/** Private presentation argument supplied to one compiled component call. */
export function transparentCallPolicyArgument(
  ctx: Ctx,
  owner: string,
  element: t.JSXElement,
): t.ObjectExpression | null {
  const entries = new Map<string, t.Expression>();
  for (const [prop, policy] of ctx.transparentGroupCallPolicies.get(element) ?? []) {
    entries.set(prop, fixedPolicyExpression(ctx, policy));
  }
  const inherited = ctx.transparentPolicyParams.get(owner);
  const sourceProps = ctx.transparentSourceProps.get(owner);
  if (inherited !== undefined && !entries.has('$default')) {
    entries.set(
      '$default',
      astFactory.optionalMemberExpression(
        cloneNode(inherited),
        astFactory.identifier('$default'),
        false,
        true,
      ),
    );
  }
  if (inherited !== undefined && sourceProps !== undefined) {
    for (const attribute of element.openingElement.attributes) {
      if (
        !astFactory.isJSXAttribute(attribute) ||
        !astFactory.isJSXIdentifier(attribute.name) ||
        !astFactory.isJSXExpressionContainer(attribute.value) ||
        !astFactory.isIdentifier(attribute.value.expression) ||
        entries.has(attribute.name.name)
      ) continue;
      const ownerProp = sourceProps.get(attribute.value.expression.name);
      if (ownerProp === undefined) continue;
      entries.set(
        attribute.name.name,
        astFactory.optionalMemberExpression(
          cloneNode(inherited),
          isValidIdentifier(ownerProp)
            ? astFactory.identifier(ownerProp)
            : astFactory.stringLiteral(ownerProp),
          !isValidIdentifier(ownerProp),
          true,
        ),
      );
    }
  }
  if (entries.size === 0) return null;
  return astFactory.objectExpression(
    [...entries].map(([prop, value]) =>
      astFactory.objectProperty(
        isValidIdentifier(prop)
          ? astFactory.identifier(prop)
          : astFactory.stringLiteral(prop),
        value,
        !isValidIdentifier(prop),
      )
    ),
  );
}

/** Component-mount statements granting disposal only to locally-created sources. */
export function transparentSourceMounts(
  ctx: Ctx,
  component: string,
  owner: t.Identifier,
): t.Statement[] {
  const transported = ctx.transparentSourceProps.get(component);
  const eventSources = ctx.eventSourceSlots.get(component);
  return [...(ctx.transparentSources.get(component) ?? [])]
    .filter((source) =>
      transported?.has(source) !== true && eventSources?.has(source) !== true
    )
    .map((source) =>
      astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'cleanup'), [
          cloneNode(owner),
          astFactory.callExpression(mdd(ctx, 'ownResolvedValue'), [
            astFactory.identifier(source),
          ]),
        ]),
      ),
    );
}
