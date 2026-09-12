import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  type ComponentPath,
  type Ctx,
  type MapCallExpression,
  type RowCtx,
} from '../context';
import {
  buildChildrenSlot,
  emitChildrenIntoParent,
  emitForwardedSlotMount,
  isRenderPropReference,
  type JsxChild,
} from '../components/children';
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
) => t.Identifier;

export function createAuthoredSlotBuilders(
  dependencies: AuthoredSlotDependencies,
): {
  buildAuthoredChildrenSlot: AuthoredChildrenSlotBuilder;
  buildAuthoredRenderValueSlot: (
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
  ) => buildChildrenSlot(
    ctx,
    ownerScope,
    ownerId,
    (childScope, parentNode, slotOwner) => {
      emitChildrenIntoParent(childScope, children, parentNode.name, {
        emitText: (expression) =>
          emitText(ctx, childScope, expression, slotOwner),
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
