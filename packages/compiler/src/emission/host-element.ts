import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode as cloneEstreeNode,
  walkAst,
  type BaseNode,
} from '../ast';
import {
  attrExpr,
  type ComponentPath,
  type Ctx,
  type MapCallExpression,
  type RowCtx,
} from '../context';
import { componentId, generatedIdentifier, md } from '../identifiers';

import {
  freshNodeName,
  freshSlot,
  pushSlotUpdater,
  renderDocument,
  slotGuard,
  type EmitScope,
} from './scope';
import { buildHandler } from '../handlers';
import {
  emitForwardedSlotMount,
  isRenderPropReference,
} from '../components/children';
import {
  collectDirectChildren,
  type DirectChildOperation,
} from '../jsx/children';
import { buildOrderedAttributes, jsxAttributeName } from '../jsx/attributes';
import {
  domAttributeWrite,
  domPropertyName,
  domPropertyWrite,
  isMappedDomAttribute,
} from '../jsx/dom-attributes';
import { createElementExpression, isSvgElement } from '../jsx/svg';
import { compileRefValue, emitRefMount } from '../jsx/refs';
import {
  preparationRead,
  registerTransparentDataSite,
  transparentExpressionSources,
} from '../data-sources';
import { emitText } from './text-node';
import { literalClassValue } from './class-value';
import type { NodeEmitter } from './node-emitter';
import { initialNode } from './initial-dom';
import { initialSite } from '../planning/initial-render';

function isInitialLiteral(value: t.Expression): boolean {
  return astFactory.isStringLiteral(value) || astFactory.isNumericLiteral(value) ||
    astFactory.isBooleanLiteral(value) || astFactory.isNullLiteral(value);
}

export interface HostElementDependencies {
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

export function emitDirectChildOperations(
  ctx: Ctx,
  scope: EmitScope,
  operations: DirectChildOperation[],
  parentVar: string,
  compName: string,
  compPath: ComponentPath,
  dependencies: HostElementDependencies,
  nestedIn: 'row' | 'cond' | null = null,
  rowCtx?: RowCtx,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, compName),
): void {
  if (scope.initialDom) return;
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
      dependencies.emitList(
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
      dependencies.emitCondition(
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

export function emitHostElement(
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
  dependencies: HostElementDependencies,
): string {
  const open = element.openingElement;
  const tag = (open.name as t.JSXIdentifier).name;
const elementSvg = isSvgElement(tag, inSvg);
const childSvg = elementSvg && tag !== 'foreignObject';
const innerHtmlAttribute = open.attributes.find(
  (attribute) =>
    astFactory.isJSXAttribute(attribute) &&
    jsxAttributeName(attribute.name) === 'innerHTML',
);
if (innerHtmlAttribute !== undefined) {
  if (elementSvg) {
    throw componentPath.buildCodeFrameError(
      'memo-dom: innerHTML is only supported on HTML elements',
    );
  }
  const hasMeaningfulChildren = element.children.some(
    (child) => !astFactory.isJSXText(child) || child.value.trim() !== '',
  );
  if (hasMeaningfulChildren) {
    throw componentPath.buildCodeFrameError(
      'memo-dom: an element using innerHTML cannot also have JSX children',
    );
  }
}

// Children emit post-order; insertion operations retain authored order.
const initial=scope.initialDom?.plan.elements[initialSite(element)];
let initialTextIndex=0;
const childOperations = collectDirectChildren(element.children, {
  emitText: (expression) => {
    const text=initial?.texts[initialTextIndex++];
    return emitText(ctx, scope, expression, ownerId, text?.path, text?.live === false, text?.empty);
  },
  emitNode: (node) =>
    dependencies.emitNode(
      ctx,
      scope,
      node,
      componentName,
      componentPath,
      nestedIn,
      rowContext,
      eventOriginId,
      childSvg,
      ownerId,
    ),
  isForwarded: (expression) =>
    isRenderPropReference(ctx, componentName, expression),
  fail: (message) => {
    throw componentPath.buildCodeFrameError(message);
  },
});
const varName = freshNodeName(ctx, scope, tag);
const needsInitialBinding=initial && (initialSite(element) === scope.initialDom!.plan.returnSite ||
  open.attributes.some(attribute=>{
    if (!astFactory.isJSXAttribute(attribute)) return true;
    if (initial.staticAttributes.includes(initialSite(attribute))) return false;
    const name=jsxAttributeName(attribute.name);
    const value=attrExpr(attribute.value);
    return /^on[A-Z]/.test(name) || value !== null && !isInitialLiteral(value);
  }));
if (scope.initialDom && !initial) throw new Error('memo-dom: initial DOM element has no binding address');
const creationExpression = initial ? null : createElementExpression(
  renderDocument(ctx, scope),
  tag,
  elementSvg,
);
if (creationExpression && element.loc !== null && element.loc !== undefined) {
  walkAst(creationExpression as unknown as BaseNode, {
    enter(node) {
      node.loc ??= element.loc;
    },
  });
}
if (!initial || needsInitialBinding) scope.creation.push(
  astFactory.variableDeclaration('const', [
    astFactory.variableDeclarator(
      astFactory.identifier(varName),
      initial ? initialNode(scope,initial.path,tag) : creationExpression!,
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
        ? compileRefValue(ctx, componentPath, componentName, value)
        : value,
    eventValue: (name, value) => {
      const handler = buildHandler(
        ctx,
        componentPath,
        value,
        name,
        componentName,
        rowContext,
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
      throw componentPath.buildCodeFrameError(message);
    },
  });
  const propObject = generatedIdentifier(ctx, `${tag}Props`);
  const sources = transparentExpressionSources(ctx, ordered.expression);
  const preparedProps = preparationRead(ctx, scope, ownerId, ordered.expression, sources);
  scope.creation.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        cloneEstreeNode(propObject),
        cloneEstreeNode(preparedProps),
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
  registerTransparentDataSite(ctx, scope, sources, ownerId, patch(preparedProps));
  scope.updaters.push(() => patch(preparedProps));
} else {
  for (const attr of open.attributes) {
  const a = attr as t.JSXAttribute;
  const attrName = jsxAttributeName(a.name);
  if (initial?.staticAttributes.includes(initialSite(a))) continue;

  if (attrName === 'ref') {
    const value = attrExpr(a.value);
    if (value === null) {
      throw componentPath.buildCodeFrameError(
        'memo-dom: ref needs an expression',
      );
    }
    emitRefMount(
      ctx,
      scope,
      astFactory.identifier(varName),
      ownerId,
      compileRefValue(ctx, componentPath, componentName, value),
    );
    continue;
  }

  // backstop: row-root keys are stripped before emission, so any key
  // reaching here is misuse (analysis catches static cases with a nicer
  // message; row/branch subtrees skip that pass)
  if (attrName === 'key') {
    throw componentPath.buildCodeFrameError(
      'memo-dom: key={...} is only meaningful on list rows: items.map(item => <Row key={item.id} />)',
      a,
    );
  }

  if (/^on[A-Z]/.test(attrName)) {
    const v = attrExpr(a.value);
    if (v == null) {
      throw componentPath.buildCodeFrameError(
        `memo-dom: ${attrName} needs a handler expression (L1)`,
      );
    }
    const handler = buildHandler(
      ctx,
      componentPath,
      v,
      attrName,
      componentName,
      rowContext,
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

  if (initial) {
    const value=attrExpr(a.value);
    if (value === null || isInitialLiteral(value)) continue;
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
    throw componentPath.buildCodeFrameError(
      `memo-dom: attribute '${attrName}' needs a string or an expression (L1)`,
    );
  }
  const dataSources = transparentExpressionSources(ctx, v);
  const expr = preparationRead(ctx, scope, ownerId, cloneEstreeNode(v));
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
    pushSlotUpdater(scope, setStyle, v);
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
        literalClassValue(expr) ?? astFactory.callExpression(md(ctx, 'classValue'), [cloneEstreeNode(expr)]),
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
  if (!initial) scope.creation.push(makeCall());
  registerTransparentDataSite(
    ctx,
    scope,
    dataSources,
    ownerId,
    makeCall(),
  );
  pushSlotUpdater(scope, makeCall, v);
}
}

emitDirectChildOperations(
  ctx,
  scope,
  childOperations,
  varName,
  componentName,
  componentPath,
  dependencies,
  nestedIn,
  rowContext,
  childSvg,
  ownerId,
);

return varName;
}
