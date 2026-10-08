import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { type ComponentPath, type MapCallExpression } from '../context';
import type { RowCtx } from './row-context';
import { type DomContext as Ctx } from './context';
import { buildChildrenSlot, emitChildrenIntoParent, emitForwardedSlotMount, isRenderPropReference } from './components/children';
import { type JsxChild } from '../jsx/children';
import type { EmitScope } from './scope';
import type { NodeEmitter } from './node-emitter';
import { emitText } from './text-node';

interface AuthoredSlotDependencies {
  emitNode: NodeEmitter;
  emitList(
    ctx: Ctx,
    scope: EmitScope,
    call: MapCallExpression,
    parentElementVariable: string,
    componentName: string,
    componentPath: ComponentPath,
    inSvg?: boolean,
    ownerId?: t.Expression,
    parentRow?: RowCtx,
  ): void;
  emitCondition(
    ctx: Ctx,
    scope: EmitScope,
    expression: t.ConditionalExpression | t.LogicalExpression,
    parentElementVariable: string,
    componentName: string,
    componentPath: ComponentPath,
    inSvg?: boolean,
    ownerId?: t.Expression,
    forwardFromOwner?: boolean,
  ): void;
}

export type AuthoredChildrenSlotBuilder = (
  ctx: Ctx,
  ownerScope: EmitScope,
  children: readonly JsxChild[],
  componentName: string,
  componentPath: ComponentPath,
  nestedIn: 'row' | 'cond' | null,
  rowContext: RowCtx | undefined,
  eventOriginId: t.Expression | undefined,
  inSvg: boolean,
  ownerId: t.Expression,
  site?: string,
) => t.Identifier;

export type AuthoredRenderValueSlotBuilder = (
  ctx: Ctx,
  ownerScope: EmitScope,
  value: t.Expression,
  componentName: string,
  componentPath: ComponentPath,
  nestedIn: 'row' | 'cond' | null,
  rowContext: RowCtx | undefined,
  eventOriginId: t.Expression | undefined,
  inSvg: boolean,
  ownerId: t.Expression,
) => t.Identifier;

export function createAuthoredSlotBuilders(
  dependencies: AuthoredSlotDependencies,
): {
  buildAuthoredChildrenSlot: AuthoredChildrenSlotBuilder;
  buildAuthoredRenderValueSlot: AuthoredRenderValueSlotBuilder;
} {
  const buildAuthoredChildrenSlot: AuthoredChildrenSlotBuilder = (
    ctx,
    ownerScope,
    children,
    componentName,
    componentPath,
    nestedIn,
    rowContext,
    eventOriginId,
    inSvg,
    ownerId,
    site,
  ) => buildChildrenSlot(
    ctx,
    ownerScope,
    ownerId,
    (childScope, parentNode, slotOwner) => {
      let textIndex = 0;
      emitChildrenIntoParent(childScope, children, parentNode.name, {
        emitText: (expression) => {
          const text = childScope.initialDom?.plan.texts?.[textIndex++];
          return emitText(ctx, childScope, expression, slotOwner, text?.path, text?.live===false, text?.empty);
        },
        emitNode: (node) =>
          dependencies.emitNode(
            ctx,
            childScope,
            node,
            componentName,
            componentPath,
            nestedIn,
            rowContext,
            eventOriginId,
            inSvg,
            slotOwner,
          ),
        emitList: (call, parentVariable) =>
          dependencies.emitList(
            ctx,
            childScope,
            call,
            parentVariable,
            componentName,
            componentPath,
            inSvg,
            slotOwner,
            rowContext,
          ),
        emitCondition: (expression, parentVariable) =>
          dependencies.emitCondition(
            ctx,
            childScope,
            expression,
            parentVariable,
            componentName,
            componentPath,
            inSvg,
            slotOwner,
            nestedIn !== null,
          ),
        isForwarded: (expression) =>
          isRenderPropReference(ctx, componentName, expression),
        emitForwarded: (expression, parentVariable) =>
          emitForwardedSlotMount(
            ctx,
            childScope,
            expression,
            parentVariable,
            slotOwner,
          ),
        fail: (message) => {
          throw componentPath.buildCodeFrameError(message);
        },
      });
    },
    site ? ownerScope.initialSlots?.[site] ?? (ownerScope.initialDom
      ? (ownerScope.initialDom.plan.slots?.[site] ?? (ctx.initialDomRoot?.component===componentName
        ? ctx.initialDomRoot : ctx.initialDomComponents[componentName])?.slots?.[site]) : undefined) : undefined,
  );

  const buildAuthoredRenderValueSlot = (
    ctx: Ctx,
    ownerScope: EmitScope,
    value: t.Expression,
    componentName: string,
    componentPath: ComponentPath,
    nestedIn: 'row' | 'cond' | null,
    rowContext: RowCtx | undefined,
    eventOriginId: t.Expression | undefined,
    inSvg: boolean,
    ownerId: t.Expression,
  ): t.Identifier => {
    const children: JsxChild[] =
      astFactory.isJSXElement(value) || astFactory.isJSXFragment(value)
        ? [value]
        : [astFactory.jsxExpressionContainer(value)];
    return buildAuthoredChildrenSlot(
      ctx,
      ownerScope,
      children,
      componentName,
      componentPath,
      nestedIn,
      rowContext,
      eventOriginId,
      inSvg,
      ownerId,
    );
  };

  return { buildAuthoredChildrenSlot, buildAuthoredRenderValueSlot };
}
