import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode, walkAst, type BaseNode } from '../ast';
import {
  attrExpr,
  exprReadsState,
  nodeHasJsx,
  type ComponentPath,
  type Ctx,
  type RowCtx,
} from '../context';
import { generatedIdentifier, md } from '../identifiers';
import type { EmitScope } from './scope';
import {
  hasComponentChildren,
  isRenderPropReference,
} from '../components/children';
import { buildOrderedAttributes, jsxAttributeName } from '../jsx/attributes';
import {
  buildSpreadComponentPropUpdate,
  callPropsFromObject,
  orderCallProps,
} from '../components/calls';
import {
  isInlineScalarCallback,
  stabilizeInlineCallbackProp,
} from '../components/callback-props';
import {
  instrumentComponentCallback,
  resolveLocalHelper,
} from '../handlers';
import { buildRenderCallbackAdapter } from './render-callback';
import { compileRefValue } from '../jsx/refs';
import {
  registerTransparentDataSite,
  transparentCallPolicyArgument,
  transparentExpressionSources,
} from '../data-sources';
import type { NodeEmitter } from './node-emitter';
import type {
  AuthoredChildrenSlotBuilder,
  AuthoredRenderValueSlotBuilder,
} from './authored-slots';

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

export function emitComponentCall(
  ctx: Ctx,
  scope: EmitScope,
  element: t.JSXElement,
  componentName: string,
  componentPath: ComponentPath,
  nestedIn: 'row' | 'cond' | null,
  rowContext: RowCtx | undefined,
  eventOriginId: t.Expression | undefined,
  inSvg: boolean,
  ownerId: t.Expression,
  emitNode: NodeEmitter,
  buildAuthoredChildrenSlot: AuthoredChildrenSlotBuilder,
  buildAuthoredRenderValueSlot: AuthoredRenderValueSlotBuilder,
): string | null {
  const open = element.openingElement;
  const tag = (open.name as t.JSXIdentifier).name;
  if (!/^[A-Z]/.test(tag)) return null;
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
    hasComponentChildren(element.children) &&
    open.attributes.some(
      (attribute) =>
        astFactory.isJSXAttribute(attribute) &&
        jsxAttributeName(attribute.name) === 'children',
    )
  ) {
    throw componentPath.buildCodeFrameError(
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
          ? compileRefValue(ctx, componentPath, componentName, value)
          : value,
      fail: (message) => {
        throw componentPath.buildCodeFrameError(message);
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
          componentName,
          componentPath,
          emitNode,
          inSvg,
          ownerId,
        );
      } else if (targetPlan?.renderProps.includes(propName) === true) {
        if (isRenderPropReference(ctx, componentName, property.value)) continue;
        if (!nodeHasJsx(property.value)) {
          throw componentPath.buildCodeFrameError(
            `memo-dom: render prop '${propName}' on <${tag}> must be JSX, a JSX-bearing conditional/list, or a forwarded render prop`,
          );
        }
        property.value = buildAuthoredRenderValueSlot(
          ctx,
          scope,
          property.value,
          componentName,
          componentPath,
          nestedIn,
          rowContext,
          eventOriginId,
          inSvg,
          ownerId,
        );
      } else if (nodeHasJsx(property.value)) {
        throw componentPath.buildCodeFrameError(
          `memo-dom: JSX prop '${propName}' on <${tag}> is not rendered by the callee; interpolate that prop in <${tag}> to declare a render slot`,
        );
      } else if (
        propName !== 'ref' &&
        targetPlan?.refProps.includes(propName) !== true &&
        isInlineScalarCallback(property.value)
      ) {
        instrumentComponentCallback(
          ctx,
          componentPath,
          property.value,
          componentName,
          rowContext,
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
      exprReadsState(ctx, orderedPropObject, componentName) ||
      (rowContext !== undefined &&
        expressionReadsBinding(orderedPropObject, rowContext.itemParam));
  } else {
  for (const attr of open.attributes) {
    const a = attr as t.JSXAttribute;
    const propName = jsxAttributeName(a.name);
    const v =
      a.value == null ? astFactory.booleanLiteral(true) : attrExpr(a.value);
    if (v == null) {
      throw componentPath.buildCodeFrameError(
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
          componentName,
          componentPath,
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
        value: compileRefValue(ctx, componentPath, componentName, v),
      });
      continue;
    }
    if (targetPlan?.renderProps.includes(propName) === true) {
      if (isRenderPropReference(ctx, componentName, v)) {
        propEntries.push({
          name: propName,
          value: cloneEstreeNode(v),
        });
        continue;
      }
      if (!nodeHasJsx(v)) {
        throw componentPath.buildCodeFrameError(
          `memo-dom: render prop '${propName}' on <${tag}> must be JSX, a JSX-bearing conditional/list, or a forwarded render prop`,
        );
      }
      propEntries.push({
        name: propName,
        value: buildAuthoredRenderValueSlot(
          ctx,
          scope,
          v,
          componentName,
          componentPath,
          nestedIn,
          rowContext,
          eventOriginId,
          inSvg,
          ownerId,
        ),
      });
      continue;
    }
    if (nodeHasJsx(v)) {
      throw componentPath.buildCodeFrameError(
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
      (exprReadsState(ctx, v, componentName) ||
        (rowContext !== undefined &&
          expressionReadsBinding(v, rowContext.itemParam)))
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
      instrumentComponentCallback(ctx, componentPath, v, componentName, rowContext, true);
    } else if (astFactory.isIdentifier(v)) {
      const localFn = resolveLocalHelper(ctx, componentPath, v.name);
      if (localFn !== null && !nodeHasJsx(localFn.body)) {
        instrumentComponentCallback(
          ctx,
          componentPath,
          localFn,
          componentName,
          rowContext,
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
  if (hasComponentChildren(element.children)) {
    if (
      open.attributes.some(
        (attribute) =>
          astFactory.isJSXAttribute(attribute) &&
          jsxAttributeName(attribute.name) === 'children',
      )
    ) {
      throw componentPath.buildCodeFrameError(
        `memo-dom: <${tag}> cannot use both a children prop and nested JSX children`,
      );
    }
    const childrenSlot = buildAuthoredChildrenSlot(
      ctx,
      scope,
      element.children,
      componentName,
      componentPath,
      nestedIn,
      rowContext,
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
    componentName,
    element,
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
