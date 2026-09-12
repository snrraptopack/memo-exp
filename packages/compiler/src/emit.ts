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
import { walkAst, type BaseNode } from './ast';
import {
  attrExpr,
  exprReadsState,
  nodeHasJsx,
  type ComponentPath,
  type Ctx,
  type RowCtx,
} from './context';
import {
  componentId,
  generatedIdentifier,
  md,
} from './identifiers';
import {
  freshNodeName,
  freshSlot,
  renderDocument,
  slotGuard,
  type EmitScope,
} from './emission/scope';
import {
  buildHandler,
  instrumentComponentCallback,
  resolveLocalHelper,
} from './handlers';
import {
  buildChildrenSlot,
  emitForwardedSlotMount,
  emitChildrenIntoParent,
  hasComponentChildren,
  isRenderPropReference,
  type JsxChild,
} from './components/children';
import {
  collectDirectChildren,
  type DirectChildOperation,
  type JsxNode,
} from './jsx/children';
import {
  buildOrderedAttributes,
  jsxAttributeName,
} from './jsx/attributes';
import {
  domAttributeWrite,
  domPropertyName,
  domPropertyWrite,
  isMappedDomAttribute,
} from './jsx/dom-attributes';
import { createElementExpression, isSvgElement } from './jsx/svg';
import {
  buildSpreadComponentPropUpdate,
  callPropsFromObject,
  orderCallProps,
} from './components/calls';
import {
  isInlineScalarCallback,
  stabilizeInlineCallbackProp,
} from './components/callback-props';
import {
  buildConditionalBranchCreate,
  emitConditionalRegion,
} from './emission/conditional-region';
import { emitListRegion } from './emission/list-region';
import { buildRenderCallbackAdapter } from './emission/render-callback';
import { compileRefValue, emitRefMount } from './jsx/refs';
import { emitRouteRegion } from './emission/route-region';
import {
  registerTransparentDataSite,
  subscribeTransparentStructuralSite,
  transparentCallPolicyArgument,
  transparentExpressionSources,
  transparentPolicyRenderer,
} from './data-sources';
import { emitText } from './emission/text-node';

function expressionReadsBinding(node: t.Node, name: string): boolean {
  let found = false;
  walkAst<BaseNode>(node as unknown as BaseNode, {
    enter(child) {
      if (
        child.type === 'Identifier' &&
        (child as unknown as { name: string }).name === name
      ) {
        found = true;
        return false;
      }
    },
  });
  return found;
}

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
    nestedIn,
    rowCtx,
    inSvg,
    ownerId,
  );
  return variable;
}

function emitDirectChildOperations(
  ctx: Ctx,
  scope: EmitScope,
  operations: DirectChildOperation[],
  parentVar: string,
  compName: string,
  compPath: ComponentPath,
  nestedIn: 'row' | 'cond' | null = null,
  rowCtx?: RowCtx,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, compName),
): void {
  for (const operation of operations) {
    if (operation.type === 'node') {
      scope.creation.push(
        astFactory.expressionStatement(
          astFactory.callExpression(
            astFactory.memberExpression(
              astFactory.identifier(parentVar),
              astFactory.identifier('appendChild'),
            ),
            [astFactory.identifier(operation.variable)],
          ),
        ),
      );
    } else if (operation.type === 'slot') {
      emitForwardedSlotMount(
        ctx,
        scope,
        operation.expression,
        parentVar,
        ownerId,
      );
    } else if (operation.type === 'list') {
      emitRegion(
        ctx,
        scope,
        operation.expression,
        parentVar,
        compName,
        compPath,
        inSvg,
        ownerId,
        rowCtx,
      );
    } else {
      emitCondRegion(
        ctx,
        scope,
        operation.expression,
        parentVar,
        compName,
        compPath,
        inSvg,
        ownerId,
        nestedIn !== null,
      );
    }
  }
}

function buildAuthoredChildrenSlot(
  ctx: Ctx,
  ownerScope: EmitScope,
  children: readonly JsxChild[],
  compName: string,
  compPath: ComponentPath,
  nestedIn: 'row' | 'cond' | null,
  rowCtx: RowCtx | undefined,
  eventOriginId: t.Expression | undefined,
  inSvg: boolean,
  ownerId: t.Expression,
): t.Identifier {
  return buildChildrenSlot(
    ctx,
    ownerScope,
    ownerId,
    (childScope, parentNode, slotOwner) => {
    emitChildrenIntoParent(
      childScope,
      children,
      parentNode.name,
      {
        emitText: (expression) =>
          emitText(ctx, childScope, expression, slotOwner),
        emitNode: (node) =>
          emitNode(
            ctx,
            childScope,
            node,
            compName,
            compPath,
            nestedIn,
            rowCtx,
            eventOriginId,
            inSvg,
            slotOwner,
          ),
        emitList: (call, parentVar) =>
          emitRegion(
            ctx,
            childScope,
            call,
            parentVar,
            compName,
            compPath,
            inSvg,
            slotOwner,
            rowCtx,
          ),
        emitCondition: (expression, parentVar) =>
          emitCondRegion(
            ctx,
            childScope,
            expression,
            parentVar,
            compName,
            compPath,
            inSvg,
            slotOwner,
            nestedIn !== null,
          ),
        isForwarded: (expression) =>
          isRenderPropReference(ctx, compName, expression),
        emitForwarded: (expression, parentVar) =>
          emitForwardedSlotMount(
            ctx,
            childScope,
            expression,
            parentVar,
            slotOwner,
          ),
        fail: (message) => {
          throw compPath.buildCodeFrameError(message);
        },
      },
    );
    },
  );
}

function buildAuthoredRenderValueSlot(
  ctx: Ctx,
  ownerScope: EmitScope,
  value: t.Expression,
  compName: string,
  compPath: ComponentPath,
  nestedIn: 'row' | 'cond' | null,
  rowCtx: RowCtx | undefined,
  eventOriginId: t.Expression | undefined,
  inSvg: boolean,
  ownerId: t.Expression,
): t.Identifier {
  const children: JsxChild[] =
    astFactory.isJSXElement(value) || astFactory.isJSXFragment(value)
      ? [value]
      : [astFactory.jsxExpressionContainer(value)];
  return buildAuthoredChildrenSlot(
    ctx,
    ownerScope,
    children,
    compName,
    compPath,
    nestedIn,
    rowCtx,
    eventOriginId,
    inSvg,
    ownerId,
  );
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
  const open = el.openingElement;
  const tag = (open.name as t.JSXIdentifier).name;

  // -- nested component: call its factory, append what it returns --------
  if (/^[A-Z]/.test(tag)) {
    // repeated children of the same type need distinct variables AND
    // distinct entity ids: 'App/Tag', 'App/Tag[1]', …
    const seen = scope.childCounts.get(tag) ?? 0;
    scope.childCounts.set(tag, seen + 1);
    const base = tag.charAt(0).toLowerCase() + tag.slice(1);
    const candidate = seen === 0 ? base : `${base}${seen}`;
    // A generated child result must never shadow a user/module binding. The
    // old `const count = Count(..., [count])` both hit the TDZ in its own
    // initializer and changed every later `count` reference in the factory.
    const varName = generatedIdentifier(ctx, candidate).name;
    const idSuffix = seen === 0 ? `/${tag}` : `/${tag}[${seen}]`;
    const propEntries: Array<{ name: string; value: t.Expression }> = [];
    const targetPlan = ctx.componentProps.get(tag);
    if (
      hasComponentChildren(el.children) &&
      open.attributes.some(
        (attribute) =>
          astFactory.isJSXAttribute(attribute) &&
          jsxAttributeName(attribute.name) === 'children',
      )
    ) {
      throw compPath.buildCodeFrameError(
        `memo-dom: <${tag}> cannot use both a children prop and nested JSX children`,
      );
    }
    const componentHasSpread = open.attributes.some((attribute) =>
      astFactory.isJSXSpreadAttribute(attribute),
    );
    let orderedPropObject: t.ObjectExpression | null = null;
    let needsPush = false;
    const dataPropSources = new Set<string>();
    if (componentHasSpread) {
      const ordered = buildOrderedAttributes(open.attributes, {
        attributeValue: (name, value) =>
          name === 'ref' || targetPlan?.refProps.includes(name) === true
            ? compileRefValue(ctx, compPath, compName, value)
            : value,
        fail: (message) => {
          throw compPath.buildCodeFrameError(message);
        },
      });
      orderedPropObject = ordered.expression;
      for (const property of orderedPropObject.properties) {
        if (
          !astFactory.isObjectProperty(property) ||
          property.computed ||
          !astFactory.isExpression(property.value)
        ) {
          continue;
        }
        const propName = astFactory.isIdentifier(property.key)
          ? property.key.name
          : astFactory.isStringLiteral(property.key)
            ? property.key.value
            : null;
        if (propName === null) continue;
        if (targetPlan?.renderCallbacks.includes(propName) === true) {
          property.value = buildRenderCallbackAdapter(
            ctx,
            scope,
            property.value,
            compName,
            compPath,
            emitNode,
            inSvg,
            ownerId,
          );
        } else if (targetPlan?.renderProps.includes(propName) === true) {
          if (isRenderPropReference(ctx, compName, property.value)) continue;
          if (!nodeHasJsx(property.value)) {
            throw compPath.buildCodeFrameError(
              `memo-dom: render prop '${propName}' on <${tag}> must be JSX, a JSX-bearing conditional/list, or a forwarded render prop`,
            );
          }
          property.value = buildAuthoredRenderValueSlot(
            ctx,
            scope,
            property.value,
            compName,
            compPath,
            nestedIn,
            rowCtx,
            eventOriginId,
            inSvg,
            ownerId,
          );
        } else if (nodeHasJsx(property.value)) {
          throw compPath.buildCodeFrameError(
            `memo-dom: JSX prop '${propName}' on <${tag}> is not rendered by the callee; interpolate that prop in <${tag}> to declare a render slot`,
          );
        } else if (
          propName !== 'ref' &&
          targetPlan?.refProps.includes(propName) !== true &&
          isInlineScalarCallback(property.value)
        ) {
          instrumentComponentCallback(
            ctx,
            compPath,
            property.value,
            compName,
            rowCtx,
            true,
          );
          property.value = stabilizeInlineCallbackProp(
            ctx,
            scope,
            property.value,
            `${propName}Callback`,
          );
        }
      }
      needsPush =
        exprReadsState(ctx, orderedPropObject, compName) ||
        (rowCtx !== undefined &&
          expressionReadsBinding(orderedPropObject, rowCtx.itemParam));
    } else {
    for (const attr of open.attributes) {
      const a = attr as t.JSXAttribute;
      const propName = jsxAttributeName(a.name);
      const v =
        a.value == null ? astFactory.booleanLiteral(true) : attrExpr(a.value);
      if (v == null) {
        throw compPath.buildCodeFrameError(
          `memo-dom: prop '${jsxAttributeName(
            a.name,
          )}' on <${tag}> must be an expression`,
        );
      }
      if (targetPlan?.renderCallbacks.includes(propName) === true) {
        propEntries.push({
          name: propName,
          value: buildRenderCallbackAdapter(
            ctx,
            scope,
            v,
            compName,
            compPath,
            emitNode,
            inSvg,
            ownerId,
          ),
        });
        continue;
      }
      if (
        propName === 'ref' ||
        targetPlan?.refProps.includes(propName) === true
      ) {
        propEntries.push({
          name: propName,
          value: compileRefValue(ctx, compPath, compName, v),
        });
        continue;
      }
      if (targetPlan?.renderProps.includes(propName) === true) {
        if (isRenderPropReference(ctx, compName, v)) {
          propEntries.push({
            name: propName,
            value: cloneEstreeNode(v),
          });
          continue;
        }
        if (!nodeHasJsx(v)) {
          throw compPath.buildCodeFrameError(
            `memo-dom: render prop '${propName}' on <${tag}> must be JSX, a JSX-bearing conditional/list, or a forwarded render prop`,
          );
        }
        propEntries.push({
          name: propName,
          value: buildAuthoredRenderValueSlot(
            ctx,
            scope,
            v,
            compName,
            compPath,
            nestedIn,
            rowCtx,
            eventOriginId,
            inSvg,
            ownerId,
          ),
        });
        continue;
      }
      if (nodeHasJsx(v)) {
        throw compPath.buildCodeFrameError(
          `memo-dom: JSX prop '${propName}' on <${tag}> is not rendered by the callee; interpolate that prop in <${tag}> to declare a render slot`,
        );
      }
      const inlineCallback = isInlineScalarCallback(v);
      if (!inlineCallback) {
        for (const source of transparentExpressionSources(ctx, v)) {
          dataPropSources.add(source);
        }
        if (dataPropSources.size > 0) needsPush = true;
      }
      // R12: instance-state reads also need re-push (parent re-renders on
      // instance writes → this updater re-syncs the child's props box)
      if (
        !inlineCallback &&
        (exprReadsState(ctx, v, compName) ||
          (rowCtx !== undefined &&
            expressionReadsBinding(v, rowCtx.itemParam)))
      ) {
        needsPush = true;
      }
      // Instrument function-valued props so writes to parent instance state
      // inside them produce the correct markDirty call. This is the same
      // treatment that callbacks passed to setInterval/addEventListener get
      // via transformComponentLifecycle — component prop functions that close
      // over parent state need identical treatment (R12 local invalidation).
      // Guard: skip JSX-bearing functions — those are component definitions,
      // not callbacks. The analyzedFunctions WeakSet in instrumentComponentCallback
      // prevents double-instrumentation if the same function was already seen
      // through a native onClick attribute on the same component.
      if (inlineCallback) {
        instrumentComponentCallback(ctx, compPath, v, compName, rowCtx, true);
      } else if (astFactory.isIdentifier(v)) {
        const localFn = resolveLocalHelper(ctx, compPath, v.name);
        if (localFn !== null && !nodeHasJsx(localFn.body)) {
          instrumentComponentCallback(
            ctx,
            compPath,
            localFn,
            compName,
            rowCtx,
            true,
          );
        }
      }
      propEntries.push({
        name: propName,
        value: inlineCallback
          ? stabilizeInlineCallbackProp(
              ctx,
              scope,
              v,
              `${propName}Callback`,
            )
          : cloneEstreeNode(v),
      });
    }
    }
    if (hasComponentChildren(el.children)) {
      if (
        open.attributes.some(
          (attribute) =>
            astFactory.isJSXAttribute(attribute) &&
            jsxAttributeName(attribute.name) === 'children',
        )
      ) {
        throw compPath.buildCodeFrameError(
          `memo-dom: <${tag}> cannot use both a children prop and nested JSX children`,
        );
      }
      const childrenSlot = buildAuthoredChildrenSlot(
        ctx,
        scope,
        el.children,
        compName,
        compPath,
        nestedIn,
        rowCtx,
        eventOriginId,
        inSvg,
        ownerId,
      );
      if (orderedPropObject !== null) {
        orderedPropObject.properties.push(
          astFactory.objectProperty(
            astFactory.identifier('children'),
            cloneEstreeNode(childrenSlot),
          ),
        );
      } else {
        propEntries.push({
          name: 'children',
          value: cloneEstreeNode(childrenSlot),
        });
      }
    }
    // Props are matched BY NAME against the callee's declared params — JSX
    // attribute order is irrelevant (positional matching silently misaligned
    // props when attribute order and declaration order disagreed).
    let props: t.Expression[];
    if (orderedPropObject !== null) {
      const propObject = generatedIdentifier(ctx, `${base}Props`);
      scope.creation.push(
        astFactory.variableDeclaration('const', [
          astFactory.variableDeclarator(
            cloneEstreeNode(propObject),
            cloneEstreeNode(orderedPropObject),
          ),
        ]),
      );
      props = callPropsFromObject(ctx, tag, propObject);
    } else {
      props = orderCallProps(ctx, tag, propEntries);
    }
    const childId = astFactory.binaryExpression(
      '+',
      cloneEstreeNode(ownerId),
      astFactory.stringLiteral(idSuffix),
    );
    const dataPolicies = transparentCallPolicyArgument(
      ctx,
      compName,
      el,
    );
    scope.creation.push(
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          astFactory.identifier(varName),
          astFactory.callExpression(astFactory.identifier(tag), [
            childId,
            cloneEstreeNode(ownerId),
            ...(props.length > 0 ? [astFactory.arrayExpression(props)] : []),
            ...(dataPolicies === null ? [] : [dataPolicies]),
          ]),
        ),
      ]),
    );
    scope.disposableEntities.push(cloneEstreeNode(childId));
    // R10: re-push state-reading props inside the parent's update — the box
    // flows down through setProps (shallow-compare → no-op when unchanged)
    const pushProps = (): t.Statement =>
      orderedPropObject === null
        ? astFactory.expressionStatement(
            astFactory.callExpression(md(ctx, 'setProps'), [
              astFactory.binaryExpression(
                '+',
                cloneEstreeNode(ownerId),
                astFactory.stringLiteral(idSuffix),
              ),
              astFactory.arrayExpression(props.map((p) => cloneEstreeNode(p))),
            ]),
          )
        : buildSpreadComponentPropUpdate(
            ctx,
            tag,
            ownerId,
            idSuffix,
            orderedPropObject,
          );
    registerTransparentDataSite(
      ctx,
      scope,
      [...dataPropSources].sort(),
      ownerId,
      pushProps(),
    );
    if (needsPush) scope.updaters.push(pushProps);
    return varName;
  }

  const elementSvg = isSvgElement(tag, inSvg);
  const childSvg = elementSvg && tag !== 'foreignObject';
  const innerHtmlAttribute = open.attributes.find(
    (attribute) =>
      astFactory.isJSXAttribute(attribute) &&
      jsxAttributeName(attribute.name) === 'innerHTML',
  );
  if (innerHtmlAttribute !== undefined) {
    if (elementSvg) {
      throw compPath.buildCodeFrameError(
        'memo-dom: innerHTML is only supported on HTML elements',
      );
    }
    const hasMeaningfulChildren = el.children.some(
      (child) => !astFactory.isJSXText(child) || child.value.trim() !== '',
    );
    if (hasMeaningfulChildren) {
      throw compPath.buildCodeFrameError(
        'memo-dom: an element using innerHTML cannot also have JSX children',
      );
    }
  }

  // Children emit post-order; insertion operations retain authored order.
  const childOperations = collectDirectChildren(el.children, {
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
        childSvg,
        ownerId,
      ),
    isForwarded: (expression) =>
      isRenderPropReference(ctx, compName, expression),
    fail: (message) => {
      throw compPath.buildCodeFrameError(message);
    },
  });
  const varName = freshNodeName(ctx, scope, tag);
  const creationExpression = createElementExpression(
    renderDocument(ctx, scope),
    tag,
    elementSvg,
  );
  if (el.loc !== null && el.loc !== undefined) {
    walkAst(creationExpression as unknown as BaseNode, {
      enter(node) {
        node.loc ??= el.loc;
      },
    });
  }
  scope.creation.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        astFactory.identifier(varName),
        creationExpression,
      ),
    ]),
  );

  // -- attributes ---------------------------------------------------------
  const hasSpread = open.attributes.some((attribute) =>
    astFactory.isJSXSpreadAttribute(attribute),
  );
  if (hasSpread) {
    const ordered = buildOrderedAttributes(open.attributes, {
      attributeValue: (name, value) =>
        name === 'ref'
          ? compileRefValue(ctx, compPath, compName, value)
          : value,
      eventValue: (name, value) => {
        const handler = buildHandler(
          ctx,
          compPath,
          value,
          name,
          compName,
          rowCtx,
          eventOriginId,
        );
        const binding = generatedIdentifier(ctx, `${name}Handler`);
        scope.creation.push(
          astFactory.variableDeclaration('const', [
            astFactory.variableDeclarator(cloneEstreeNode(binding), handler),
          ]),
        );
        return binding;
      },
      fail: (message) => {
        throw compPath.buildCodeFrameError(message);
      },
    });
    const propObject = generatedIdentifier(ctx, `${tag}Props`);
    scope.creation.push(
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          cloneEstreeNode(propObject),
          cloneEstreeNode(ordered.expression),
        ),
      ]),
    );
    const patch = (value: t.Expression): t.Statement =>
      astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'patchDomProps'), [
          astFactory.identifier(varName),
          cloneEstreeNode(value),
          astFactory.stringLiteral(ctx.rootId),
          astFactory.arrayExpression(
            ordered.safeEventKeys.map((name) => astFactory.stringLiteral(name)),
          ),
        ]),
      );
    scope.creation.push(patch(propObject));
    emitRefMount(
      ctx,
      scope,
      astFactory.identifier(varName),
      ownerId,
      astFactory.memberExpression(cloneEstreeNode(propObject), astFactory.identifier('ref')),
    );
    scope.updaters.push(() => patch(ordered.expression));
  } else {
    for (const attr of open.attributes) {
    const a = attr as t.JSXAttribute;
    const attrName = jsxAttributeName(a.name);

    if (attrName === 'ref') {
      const value = attrExpr(a.value);
      if (value === null) {
        throw compPath.buildCodeFrameError(
          'memo-dom: ref needs an expression',
        );
      }
      emitRefMount(
        ctx,
        scope,
        astFactory.identifier(varName),
        ownerId,
        compileRefValue(ctx, compPath, compName, value),
      );
      continue;
    }

    // backstop: row-root keys are stripped before emission, so any key
    // reaching here is misuse (analysis catches static cases with a nicer
    // message; row/branch subtrees skip that pass)
    if (attrName === 'key') {
      throw compPath.buildCodeFrameError(
        'memo-dom: key={...} is only meaningful on list rows: items.map(item => <Row key={item.id} />)',
        a,
      );
    }

    if (/^on[A-Z]/.test(attrName)) {
      const v = attrExpr(a.value);
      if (v == null) {
        throw compPath.buildCodeFrameError(
          `memo-dom: ${attrName} needs a handler expression (L1)`,
        );
      }
      const handler = buildHandler(
        ctx,
        compPath,
        v,
        attrName,
        compName,
        rowCtx,
        eventOriginId,
      );
      const delegatedBinding = scope.delegatedEventBindings.get(attrName);
      scope.creation.push(
        delegatedBinding === undefined
          ? astFactory.expressionStatement(
              astFactory.assignmentExpression(
                '=',
                astFactory.memberExpression(
                  astFactory.identifier(varName),
                  astFactory.identifier(attrName.toLowerCase()),
                ),
                handler,
              ),
            )
          : astFactory.expressionStatement(
              astFactory.callExpression(md(ctx, 'setDelegatedEvent'), [
                astFactory.identifier(delegatedBinding),
                astFactory.identifier(varName),
                handler,
              ]),
            ),
      );
      continue;
    }

    if (astFactory.isStringLiteral(a.value)) {
      if (attrName === 'class' || attrName === 'className') {
        scope.creation.push(
          astFactory.expressionStatement(
            astFactory.callExpression(md(ctx, 'setClassValue'), [
              astFactory.identifier(varName),
              astFactory.stringLiteral(a.value.value),
            ]),
          ),
        );
      } else if (attrName === 'style') {
        scope.creation.push(
          astFactory.expressionStatement(
            astFactory.callExpression(md(ctx, 'setStyleValue'), [
              astFactory.identifier(varName),
              astFactory.stringLiteral(a.value.value),
            ]),
          ),
        );
      } else if (domPropertyName(attrName, elementSvg) !== null) {
        scope.creation.push(
          domPropertyWrite(
            varName,
            attrName,
            astFactory.stringLiteral(a.value.value),
          ),
        );
      } else if (isMappedDomAttribute(attrName, elementSvg)) {
        scope.creation.push(
          domAttributeWrite(
            varName,
            attrName,
            astFactory.stringLiteral(a.value.value),
          ),
        );
      } else if (elementSvg) {
        scope.creation.push(
          astFactory.expressionStatement(
            astFactory.callExpression(md(ctx, 'setDomValue'), [
              astFactory.identifier(varName),
              astFactory.stringLiteral(attrName),
              astFactory.stringLiteral(a.value.value),
            ]),
          ),
        );
      } else {
        scope.creation.push(
          astFactory.expressionStatement(
            astFactory.callExpression(
              astFactory.memberExpression(astFactory.identifier(varName), astFactory.identifier('setAttribute')),
              [astFactory.stringLiteral(attrName), astFactory.stringLiteral(a.value.value)],
            ),
          ),
        );
      }
      continue;
    }

    const v =
      a.value == null ? astFactory.booleanLiteral(true) : attrExpr(a.value);
    if (v == null) {
      throw compPath.buildCodeFrameError(
        `memo-dom: attribute '${attrName}' needs a string or an expression (L1)`,
      );
    }
    const dataSources = transparentExpressionSources(ctx, v);
    const expr = cloneEstreeNode(v);
    if (attrName === 'style') {
      const setStyle = (): t.Statement =>
        astFactory.expressionStatement(
          astFactory.callExpression(md(ctx, 'setStyleValue'), [
            astFactory.identifier(varName),
            cloneEstreeNode(expr),
          ]),
        );
      scope.creation.push(setStyle());
      registerTransparentDataSite(
        ctx,
        scope,
        dataSources,
        ownerId,
        setStyle(),
      );
      scope.updaters.push(setStyle);
      continue;
    }
    const key = freshSlot(ctx, scope);
    // M5.8: IDL-property attributes (checked, value, disabled, …) write the
    // DOM property, not the attribute — faster (no attribute-tree walk) and
    // semantically correct for state that lives on the element object.
    const propName = domPropertyName(attrName, elementSvg);
    // M5.9: inline guarded writes (see slotGuard) — no MD.setX call overhead
    const makeCall = (): t.Statement => {
      if (attrName === 'class' || attrName === 'className') {
        return slotGuard(
          scope,
          key,
          astFactory.callExpression(md(ctx, 'classValue'), [cloneEstreeNode(expr)]),
          (tmp) =>
            astFactory.expressionStatement(
              astFactory.callExpression(md(ctx, 'setClassValue'), [
                astFactory.identifier(varName),
                tmp,
              ]),
            ),
        );
      }
      if (propName !== null) {
        return slotGuard(scope, key, cloneEstreeNode(expr), (tmp) =>
          domPropertyWrite(varName, propName, tmp),
        );
      }
      if (isMappedDomAttribute(attrName, elementSvg)) {
        return slotGuard(scope, key, cloneEstreeNode(expr), (tmp) =>
          domAttributeWrite(varName, attrName, tmp),
        );
      }
      if (elementSvg) {
        return slotGuard(scope, key, cloneEstreeNode(expr), (tmp) =>
          astFactory.expressionStatement(
            astFactory.callExpression(md(ctx, 'setDomValue'), [
              astFactory.identifier(varName),
              astFactory.stringLiteral(attrName),
              tmp,
            ]),
          ),
        );
      }
      return slotGuard(scope, key, cloneEstreeNode(expr), (tmp) =>
        domAttributeWrite(varName, attrName, tmp),
      );
    };
    scope.creation.push(makeCall());
    registerTransparentDataSite(
      ctx,
      scope,
      dataSources,
      ownerId,
      makeCall(),
    );
    scope.updaters.push(makeCall);
  }
  }

  emitDirectChildOperations(
    ctx,
    scope,
    childOperations,
    varName,
    compName,
    compPath,
    nestedIn,
    rowCtx,
    childSvg,
    ownerId,
  );

  return varName;
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
