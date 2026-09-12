/**
 * emit.ts - JSX DOM nodes and structural-region emission.
 *
 *   R2  JSX → creation branch with cached node variables (post-order)
 *   R3  dynamic expressions → numbered slots with guarded setters
 *   R4  creation runs the same guarded setters (null cache → first write)
 *   R7  {items.map(item => …)} → createListRegion + row factories
 *
 * Component factory ABI and registration live in emission/component.ts.
 * Emission state is explicit (EmitScope) rather than closure-local so that
 * inline list rows can emit into a NESTED scope: an inline row is a small
 * entity factory of its own (own slots, own update, register parent=id),
 * created per item by the region.
 */

import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import { cloneNode as cloneEstreeNode } from './ast';
import {
  type ComponentPath,
  type Ctx,
  type RowCtx,
} from './context';
import {
  componentId,
} from './identifiers';
import {
  freshNodeName,
  renderDocument,
  type EmitScope,
} from './emission/scope';
import {
  isRenderPropReference,
} from './components/children';
import {
  collectDirectChildren,
  type JsxNode,
} from './jsx/children';
import {
  buildConditionalBranchCreate,
  emitConditionalRegion,
} from './emission/conditional-region';
import { emitListRegion } from './emission/list-region';
import { emitRouteRegion } from './emission/route-region';
import {
  subscribeTransparentStructuralSite,
  transparentPolicyRenderer,
} from './data-sources';
import { emitText } from './emission/text-node';
import { emitComponentCall } from './emission/component-call';
import {
  emitDirectChildOperations,
  emitHostElement,
  type HostElementDependencies,
} from './emission/host-element';
import { createAuthoredSlotBuilders } from './emission/authored-slots';

const {
  buildAuthoredChildrenSlot,
  buildAuthoredRenderValueSlot,
} = createAuthoredSlotBuilders({
  emitNode,
  emitList: emitRegion,
  emitCondition: emitCondRegion,
});

const hostElementDependencies: HostElementDependencies = {
  emitNode,
  emitList: emitRegion,
  emitCondition: emitCondRegion,
};

export function emitNode(
  ctx: Ctx,
  scope: EmitScope,
  node: JsxNode,
  compName: string,
  compPath: ComponentPath,
  nestedIn: 'row' | 'cond' | null = null,
  rowCtx?: RowCtx,
  eventOriginId?: t.Expression,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, compName),
): string {
  return astFactory.isJSXFragment(node)
    ? emitFragment(
        ctx,
        scope,
        node,
        compName,
        compPath,
        nestedIn,
        rowCtx,
        eventOriginId,
        inSvg,
        ownerId,
      )
    : emitElement(
        ctx,
        scope,
        node,
        compName,
        compPath,
        nestedIn,
        rowCtx,
        eventOriginId,
        inSvg,
        ownerId,
      );
}

function emitFragment(
  ctx: Ctx,
  scope: EmitScope,
  fragment: t.JSXFragment,
  compName: string,
  compPath: ComponentPath,
  nestedIn: 'row' | 'cond' | null,
  rowCtx?: RowCtx,
  eventOriginId?: t.Expression,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, compName),
): string {
  const operations = collectDirectChildren(fragment.children, {
    emitText: (expression) => emitText(ctx, scope, expression, ownerId),
    emitNode: (node) =>
      emitNode(
        ctx,
        scope,
        node,
        compName,
        compPath,
        nestedIn,
        rowCtx,
        eventOriginId,
        inSvg,
        ownerId,
      ),
    isForwarded: (expression) =>
      isRenderPropReference(ctx, compName, expression),
    fail: (message) => {
      throw compPath.buildCodeFrameError(message);
    },
  });
  const variable = freshNodeName(ctx, scope, 'fragment');
  scope.creation.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        astFactory.identifier(variable),
        astFactory.callExpression(
          astFactory.memberExpression(
            renderDocument(ctx, scope),
            astFactory.identifier('createDocumentFragment'),
          ),
          [],
        ),
      ),
    ]),
  );
  emitDirectChildOperations(
    ctx,
    scope,
    operations,
    variable,
    compName,
    compPath,
    hostElementDependencies,
    nestedIn,
    rowCtx,
    inSvg,
    ownerId,
  );
  return variable;
}

function emitElement(
  ctx: Ctx,
  scope: EmitScope,
  el: t.JSXElement,
  compName: string,
  compPath: ComponentPath,
  nestedIn: 'row' | 'cond' | null = null,
  rowCtx?: RowCtx,
  eventOriginId?: t.Expression,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, compName),
): string {
  const policyRenderer = transparentPolicyRenderer(el);
  if (policyRenderer !== null) {
    const seen = scope.childCounts.get('$dataPolicy') ?? 0;
    scope.childCounts.set('$dataPolicy', seen + 1);
    const suffix = seen === 0
      ? '/$dataPolicy'
      : `/$dataPolicy[${seen}]`;
    const childId = astFactory.binaryExpression(
      '+',
      cloneEstreeNode(ownerId),
      astFactory.stringLiteral(suffix),
    );
    const variable = freshNodeName(ctx, scope, 'dataPolicy');
    scope.creation.push(
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          astFactory.identifier(variable),
          astFactory.callExpression(cloneEstreeNode(policyRenderer.renderer), [
            cloneEstreeNode(childId),
            cloneEstreeNode(ownerId),
            ...policyRenderer.args.map((argument) => cloneEstreeNode(argument, true)),
          ]),
        ),
      ]),
    );
    scope.disposableEntities.push(cloneEstreeNode(childId));
    return variable;
  }
  const route = ctx.routeElements.get(el);
  if (route !== undefined) {
    return emitRouteRegion(
      ctx,
      scope,
      el,
      route,
      compName,
      compPath,
      emitNode,
      inSvg,
      ownerId,
    );
  }
  const componentResult = emitComponentCall(
    ctx,
    scope,
    el,
    compName,
    compPath,
    nestedIn,
    rowCtx,
    eventOriginId,
    inSvg,
    ownerId,
    emitNode,
    buildAuthoredChildrenSlot,
    buildAuthoredRenderValueSlot,
  );
  if (componentResult !== null) return componentResult;

  return emitHostElement(
    ctx,
    scope,
    el,
    compName,
    compPath,
    nestedIn,
    rowCtx,
    eventOriginId,
    inSvg,
    ownerId,
    hostElementDependencies,
  );
}

// ---------------------------------------------------------------------
// R7: list regions
// ---------------------------------------------------------------------

function emitRegion(
  ctx: Ctx,
  scope: EmitScope,
  call: import('./context').MapCallExpression,
  parentElVar: string,
  compName: string,
  compPath: ComponentPath,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, compName),
  parentRow?: RowCtx,
): void {
  emitListRegion(
    ctx,
    scope,
    call,
    parentElVar,
    compName,
    compPath,
    emitNode,
    buildAuthoredChildrenSlot,
    inSvg,
    ownerId,
    parentRow,
  );
  subscribeTransparentStructuralSite(ctx, scope, call, ownerId);
}

// ---------------------------------------------------------------------
// R8: conditional regions
// ---------------------------------------------------------------------

/**
 * `{cond ? <A/> : <B/>}` → an anchored conditional region, registered as its
 * OWN entity ('<ownerId>/when<n>') so the table routes the region's vars to
 * it. The render closure is `() => whenN.update()` — a closure over the
 * region variable declared right after (same pattern as the component's own
 * update closure; render only runs post-mount).
 */
function emitCondRegion(
  ctx: Ctx,
  scope: EmitScope,
  expr: t.ConditionalExpression | t.LogicalExpression,
  parentElVar: string,
  compName: string,
  compPath: ComponentPath,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, compName),
  forwardFromOwner = false,
): void {
  emitConditionalRegion(
    ctx,
    scope,
    expr,
    parentElVar,
    compName,
    compPath,
    emitNode,
    inSvg,
    ownerId,
    forwardFromOwner,
  );
}

/**
 * A branch is a small factory: own slot cache, own guarded update closure,
 * NO register (branches are not entities — a swap just removes their nodes).
 * Emitted into a fresh EmitScope so variables and slots never collide.
 */
export function buildBranchCreate(
  ctx: Ctx,
  jsx: JsxNode,
  compName: string,
  compPath: ComponentPath,
  regionId: t.Expression,
  inSvg = false,
  ownerId: t.Expression = regionId,
  allowConditions = false,
  usedConds?: { count: number },
): t.ArrowFunctionExpression {
  return buildConditionalBranchCreate(
    ctx,
    jsx,
    compName,
    compPath,
    regionId,
    emitNode,
    inSvg,
    ownerId,
    allowConditions,
    usedConds,
  );
}
