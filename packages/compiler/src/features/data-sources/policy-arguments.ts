/** Component-call policy propagation and source ownership emission. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {
  cloneNode,
  isValidIdentifier,
} from '../../ast';
import { type DomContext as Ctx } from '../../dom/context';
import { type TransparentPresentationComponent, type TransparentPresentationPolicy } from '../../context';
import { orderCallProps } from '../../dom/components/calls';
import { generatedIdentifier, md, mdd } from '../../dom/identifiers';

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
  const plan = ctx.componentProps.get(component);
  // Policy callbacks may consume either argument (or neither). Project only
  // implicit framework arguments; explicit authored props still validate.
  const entries = (kind === 'error'
    ? [
        { name: 'error', value: cloneNode(error) as t.Expression },
        { name: 'retry', value: cloneNode(retry) as t.Expression },
      ]
    : []).filter(entry =>
      plan === undefined || plan.acceptsUnknown || plan.names.includes(entry.name));
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
  inherited?: t.Expression,
): t.ObjectExpression {
  return astFactory.objectExpression([
    ...(inherited === undefined ? [] : [astFactory.spreadElement(cloneNode(inherited))]),
    ...(policy.pending === undefined ? [] : [
      astFactory.objectProperty(
        astFactory.identifier('pending'),
        policyComponentRenderer(ctx, policy.pending, 'pending'),
      ),
    ]),
    ...(policy.error === undefined ? [] : [
      astFactory.objectProperty(
        astFactory.identifier('error'),
        policyComponentRenderer(ctx, policy.error, 'error'),
      ),
    ]),
  ]);
}

/** Effective default policy at an independently activating atomic region. */
export function transparentBoundaryPolicyArgument(
  ctx: Ctx,
  owner: string,
  policy: TransparentPresentationPolicy,
): t.Expression {
  const inherited = ctx.transparentPolicyParams.get(owner);
  return fixedPolicyExpression(ctx, policy, inherited === undefined
    ? undefined
    : astFactory.optionalMemberExpression(cloneNode(inherited), astFactory.identifier('$default'), false, true));
}

/** Private presentation argument supplied to one compiled component call. */
export function transparentCallPolicyArgument(
  ctx: Ctx,
  owner: string,
  element: t.JSXElement,
): t.ObjectExpression | null {
  const entries = new Map<string, t.Expression>();
  const inherited = ctx.transparentPolicyParams.get(owner);
  for (const [prop, policy] of ctx.transparentGroupCallPolicies.get(element) ?? []) {
    const inheritedDefault = inherited === undefined ? undefined : astFactory.optionalMemberExpression(
      cloneNode(inherited), astFactory.identifier('$default'), false, true,
    );
    const inheritedProp = inherited === undefined || prop === '$default' ? inheritedDefault
      : astFactory.logicalExpression('??', astFactory.optionalMemberExpression(
          cloneNode(inherited), isValidIdentifier(prop) ? astFactory.identifier(prop) : astFactory.stringLiteral(prop),
          !isValidIdentifier(prop), true,
        ), inheritedDefault!);
    entries.set(prop, fixedPolicyExpression(ctx, policy, inheritedProp));
  }
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
