import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode as cloneEstreeNode,
  isValidIdentifier as isValidEstreeIdentifier,
} from '../ast';
import {
  attrExpr,
  keyPathOf,
  nodeHasJsx,
  type ComponentPath,
  type Ctx,
  type RowCtx,
} from '../context';
import {
  componentId,
  generatedIdentifier,
  md,
} from '../identifiers';
import { type MapSite } from '../lists';
import { isLightweightRowComponent } from '../analysis';
import {
  hasComponentChildren,
  isRenderPropReference,
  type JsxChild,
} from '../components/children';
import {
  buildOrderedAttributes,
  jsxAttributeName,
} from '../jsx/attributes';
import {
  callPropsFromObject,
  orderCallProps,
} from '../components/calls';
import { simpleObjectPropBindings } from '../components/props';
import {
  isInlineScalarCallback,
  stabilizeInlineCallbackStatement,
} from '../components/callback-props';
import {
  cacheDecl,
  newEmitScope,
  updateDecl,
  type EmitScope,
} from './scope';
import { compileRefValue } from '../jsx/refs';
import {
  instrumentComponentCallback,
  resolveLocalHelper,
} from '../handlers';
import type { AuthoredChildrenSlotBuilder } from './authored-slots';

interface ComponentRowFactoryPlan {
  ctx: Ctx;
  site: MapSite;
  rowComponent: string;
  rowId: t.Identifier;
  nextItem: t.Identifier;
  nextIndex: t.Identifier | null;
  rowRefresh: t.Identifier;
  rowScope: EmitScope;
  result: t.Identifier;
  lightweight: boolean;
  needsUpdateProps: boolean;
  reuseLightweightEntry: boolean;
  lightweightPushProps: t.Identifier | null;
  ownerId: t.Expression;
  eventBindings: ReadonlyMap<string, t.Identifier>;
  prefixStatements: t.Statement[];
  callProps: t.Expression[];
  updateStatements: t.Statement[];
}

function buildComponentRowFactory({
  ctx,
  site,
  rowComponent,
  rowId,
  nextItem,
  nextIndex,
  rowRefresh,
  rowScope,
  result,
  lightweight,
  needsUpdateProps,
  reuseLightweightEntry,
  lightweightPushProps,
  ownerId,
  eventBindings,
  prefixStatements,
  callProps,
  updateStatements,
}: ComponentRowFactoryPlan): t.ArrowFunctionExpression {
  const entryProperties: t.ObjectProperty[] = lightweight
    ? [
        astFactory.objectProperty(
          astFactory.identifier('nodes'),
          astFactory.memberExpression(cloneEstreeNode(result), astFactory.identifier('nodes')),
        ),
        astFactory.objectProperty(astFactory.identifier('entities'), astFactory.arrayExpression([])),
        astFactory.objectProperty(
          astFactory.identifier('update'),
          astFactory.memberExpression(cloneEstreeNode(result), astFactory.identifier('update')),
        ),
        astFactory.objectProperty(
          astFactory.identifier('dispose'),
          astFactory.memberExpression(cloneEstreeNode(result), astFactory.identifier('dispose')),
        ),
      ]
    : [
        astFactory.objectProperty(
          astFactory.identifier('nodes'),
          astFactory.callExpression(md(ctx, 'rootNodes'), [cloneEstreeNode(result)]),
        ),
        astFactory.objectProperty(
          astFactory.identifier('entities'),
          astFactory.arrayExpression([cloneEstreeNode(rowId)]),
        ),
      ];
  if (needsUpdateProps && !reuseLightweightEntry) {
    entryProperties.push(
      astFactory.objectProperty(
        astFactory.identifier('updateProps'),
        astFactory.arrowFunctionExpression(
          [
            cloneEstreeNode(nextItem),
            ...(nextIndex === null ? [] : [cloneEstreeNode(nextIndex)]),
          ],
          astFactory.blockStatement(updateStatements),
        ),
      ),
    );
  }

  return astFactory.arrowFunctionExpression(
    [
      cloneEstreeNode(site.itemPattern, true),
      cloneEstreeNode(rowId),
      ...(site.indexParam === null ? [] : [astFactory.identifier(site.indexParam)]),
    ],
    astFactory.blockStatement([
      ...(rowScope.updaters.length > 0
        ? [cacheDecl(rowScope), updateDecl(rowScope)]
        : []),
      ...rowScope.prelude,
      ...rowScope.creation,
      ...rowScope.mounts,
      ...prefixStatements,
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          cloneEstreeNode(result),
          lightweight
            ? astFactory.callExpression(astFactory.identifier(rowComponent), [
                ...callProps.map((prop) => cloneEstreeNode(prop)),
                cloneEstreeNode(rowId),
                ...(site.sourceLocal ? [cloneEstreeNode(ownerId)] : []),
                ...[...eventBindings.values()].map((binding) =>
                  cloneEstreeNode(binding),
                ),
              ])
            : astFactory.callExpression(astFactory.identifier(rowComponent), [
                cloneEstreeNode(rowId),
                cloneEstreeNode(ownerId),
                ...(callProps.length > 0
                  ? [astFactory.arrayExpression(callProps)]
                  : []),
              ]),
        ),
      ]),
      ...(rowScope.updaters.length > 0
        ? [
            astFactory.variableDeclaration('const', [
              astFactory.variableDeclarator(
                cloneEstreeNode(rowRefresh),
                astFactory.arrowFunctionExpression(
                  [],
                  astFactory.blockStatement([
                    astFactory.expressionStatement(
                      lightweight
                        ? astFactory.callExpression(
                            astFactory.memberExpression(
                              cloneEstreeNode(result),
                              astFactory.identifier('update'),
                            ),
                            [],
                          )
                        : astFactory.callExpression(md(ctx, 'markDirty'), [
                            cloneEstreeNode(rowId),
                          ]),
                    ),
                    astFactory.expressionStatement(
                      astFactory.callExpression(astFactory.identifier(rowScope.updateVar), []),
                    ),
                  ]),
                ),
              ),
            ]),
          ]
        : []),
      ...(lightweightPushProps === null
        ? []
        : [
            astFactory.variableDeclaration('const', [
              astFactory.variableDeclarator(
                cloneEstreeNode(lightweightPushProps),
                astFactory.memberExpression(
                  cloneEstreeNode(result),
                  astFactory.identifier('updateProps'),
                ),
              ),
            ]),
            astFactory.expressionStatement(
              astFactory.assignmentExpression(
                '=',
                astFactory.memberExpression(
                  cloneEstreeNode(result),
                  astFactory.identifier('updateProps'),
                ),
                astFactory.arrowFunctionExpression(
                  [
                    cloneEstreeNode(nextItem),
                    ...(nextIndex === null ? [] : [cloneEstreeNode(nextIndex)]),
                  ],
                  astFactory.blockStatement(updateStatements),
                ),
              ),
            ),
          ]),
      astFactory.returnStatement(
        reuseLightweightEntry
          ? cloneEstreeNode(result)
          : astFactory.objectExpression(entryProperties),
      ),
    ]),
  );
}

export function buildComponentRowCreate(
  ctx: Ctx,
  site: MapSite,
  componentName: string,
  componentPath: ComponentPath,
  buildAuthoredChildrenSlot: AuthoredChildrenSlotBuilder,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, componentName),
  eventBindings: ReadonlyMap<string, t.Identifier> = new Map(),
): t.ArrowFunctionExpression {
  const rowComponent = site.rowComp!;
  const rowId = generatedIdentifier(ctx, 'rowId');
  const nextItem = generatedIdentifier(ctx, 'nextItem');
  const nextIndex =
    site.indexParam === null
      ? null
      : generatedIdentifier(ctx, 'nextIndex');
  const rowRefresh = generatedIdentifier(ctx, 'refreshRow');
  const rowScope = newEmitScope(ctx);
  const lightweight = isLightweightRowComponent(ctx, rowComponent);
  const rowContext: RowCtx = {
    itemParam: site.itemParam,
    itemPath: [],
    rowIdVar: rowId.name,
    keyPath: keyPathOf(site.keyExpr, site.itemParam),
    sourceKey: site.sourceKey,
    sourceLocal: site.sourceLocal,
    ...(site.sourceLocal
      ? {
          ownerIdVar: astFactory.isIdentifier(ownerId)
            ? ownerId.name
            : componentId(ctx, componentName).name,
        }
      : {}),
  };
  const attributes = site.jsx!.openingElement.attributes.filter(
    (attribute) =>
      astFactory.isJSXSpreadAttribute(attribute) ||
      jsxAttributeName(attribute.name) !== 'key',
  );
  const hasSpread = attributes.some((attribute) =>
    astFactory.isJSXSpreadAttribute(attribute),
  );
  const propEntries: Array<{ name: string; value: t.Expression }> = [];
  const prefixStatements: t.Statement[] = [];
  let propObjectExpression: t.ObjectExpression | null = null;
  const targetPlan = ctx.componentProps.get(rowComponent);
  const positionalObjectProps =
    lightweight &&
    (ctx.linkedComponentRows.get(rowComponent)?.length ?? 0) === 0 &&
    targetPlan !== undefined
      ? simpleObjectPropBindings(targetPlan)
      : null;
  const positionalPropsFromEntries = (): t.Expression[] => {
    for (const { name } of propEntries) {
      if (!positionalObjectProps!.some((binding) => binding.name === name)) {
        throw componentPath.buildCodeFrameError(
          `memo-dom: unknown prop '${name}' on <${rowComponent}> - declared props: ${positionalObjectProps!
            .map((binding) => binding.name)
            .join(', ')}`,
        );
      }
    }
    const byName = new Map(
      propEntries.map(({ name, value }) => [name, value]),
    );
    return positionalObjectProps!.map(({ name }) =>
      cloneEstreeNode(byName.get(name) ?? astFactory.identifier('undefined')),
    );
  };
  const positionalPropsFromObject = (
    object: t.Expression,
  ): t.Expression[] =>
    positionalObjectProps!.map(({ name }) =>
      astFactory.memberExpression(
        cloneEstreeNode(object),
        isValidEstreeIdentifier(name)
          ? astFactory.identifier(name)
          : astFactory.stringLiteral(name),
        !isValidEstreeIdentifier(name),
      ),
    );
  const renderValueSlot = (value: t.Expression): t.Identifier => {
    const children: JsxChild[] =
      astFactory.isJSXElement(value) || astFactory.isJSXFragment(value)
        ? [value]
        : [astFactory.jsxExpressionContainer(value)];
    return buildAuthoredChildrenSlot(
      ctx,
      rowScope,
      children,
      componentName,
      componentPath,
      'row',
      rowContext,
      rowId,
      inSvg,
      rowId,
    );
  };

  if (hasSpread) {
    propObjectExpression = buildOrderedAttributes(attributes, {
      attributeValue: (name, value) =>
        name === 'ref' || targetPlan?.refProps.includes(name) === true
          ? compileRefValue(ctx, componentPath, componentName, value)
          : value,
      fail: (message) => {
        throw componentPath.buildCodeFrameError(message);
      },
    }).expression;
    for (const property of propObjectExpression.properties) {
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
      if (targetPlan?.renderProps.includes(propName) === true) {
        if (isRenderPropReference(ctx, componentName, property.value)) continue;
        if (!nodeHasJsx(property.value)) {
          throw componentPath.buildCodeFrameError(
            `memo-dom: render prop '${propName}' on <${rowComponent}> must be JSX, a JSX-bearing conditional/list, or a forwarded render prop`,
          );
        }
        property.value = renderValueSlot(property.value);
      } else if (nodeHasJsx(property.value)) {
        throw componentPath.buildCodeFrameError(
          `memo-dom: JSX prop '${propName}' on <${rowComponent}> is not rendered by the callee; interpolate that prop in <${rowComponent}> to declare a render slot`,
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
        property.value = stabilizeInlineCallbackStatement(
          ctx,
          prefixStatements,
          property.value,
          `${propName}Callback`,
        );
      }
    }
  } else {
    for (const attribute of attributes) {
      const direct = attribute as t.JSXAttribute;
      const propName = jsxAttributeName(direct.name);
      const value =
        direct.value == null ? astFactory.booleanLiteral(true) : attrExpr(direct.value);
      if (value === null) {
        throw componentPath.buildCodeFrameError(
          `memo-dom: prop '${jsxAttributeName(
            direct.name,
          )}' on <${rowComponent}> must be an expression`,
        );
      }
      if (targetPlan?.renderProps.includes(propName) === true) {
        if (isRenderPropReference(ctx, componentName, value)) {
          propEntries.push({
            name: propName,
            value: cloneEstreeNode(value),
          });
          continue;
        }
        if (!nodeHasJsx(value)) {
          throw componentPath.buildCodeFrameError(
            `memo-dom: render prop '${propName}' on <${rowComponent}> must be JSX, a JSX-bearing conditional/list, or a forwarded render prop`,
          );
        }
        propEntries.push({
          name: propName,
          value: renderValueSlot(value),
        });
        continue;
      }
      if (
        propName === 'ref' ||
        targetPlan?.refProps.includes(propName) === true
      ) {
        propEntries.push({
          name: propName,
          value: compileRefValue(
            ctx,
            componentPath,
            componentName,
            value,
          ),
        });
        continue;
      }
      if (nodeHasJsx(value)) {
        throw componentPath.buildCodeFrameError(
          `memo-dom: JSX prop '${propName}' on <${rowComponent}> is not rendered by the callee; interpolate that prop in <${rowComponent}> to declare a render slot`,
        );
      }
      const inlineCallback = isInlineScalarCallback(value);
      if (inlineCallback) {
        instrumentComponentCallback(
          ctx,
          componentPath,
          value,
          componentName,
          rowContext,
          true,
        );
      } else if (astFactory.isIdentifier(value)) {
        const localFn = resolveLocalHelper(ctx, componentPath, value.name);
        if (localFn !== null && !nodeHasJsx(localFn.body)) {
          instrumentComponentCallback(
            ctx,
            componentPath,
            localFn,
            componentName,
            undefined,
            true,
          );
        }
      }
      propEntries.push({
        name: propName,
        value: inlineCallback
          ? stabilizeInlineCallbackStatement(
              ctx,
              prefixStatements,
              value,
              `${propName}Callback`,
            )
          : cloneEstreeNode(value),
      });
    }
  }

  if (hasComponentChildren(site.jsx!.children)) {
    if (
      attributes.some(
        (attribute) =>
          astFactory.isJSXAttribute(attribute) &&
          jsxAttributeName(attribute.name) === 'children',
      )
    ) {
      throw componentPath.buildCodeFrameError(
        `memo-dom: <${rowComponent}> cannot use both a children prop and nested JSX children`,
      );
    }
    const childrenSlot = buildAuthoredChildrenSlot(
      ctx,
      rowScope,
      site.jsx!.children,
      componentName,
      componentPath,
      'row',
      rowContext,
      rowId,
      inSvg,
      rowId,
    );
    if (propObjectExpression !== null) {
      propObjectExpression.properties.push(
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

  let callProps: t.Expression[];
  if (propObjectExpression !== null) {
    const propObject = generatedIdentifier(ctx, `${rowComponent}Props`);
    prefixStatements.push(
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          cloneEstreeNode(propObject),
          cloneEstreeNode(propObjectExpression),
        ),
      ]),
    );
    callProps =
      positionalObjectProps === null
        ? callPropsFromObject(ctx, rowComponent, propObject)
        : positionalPropsFromObject(propObject);
  } else {
    callProps =
      positionalObjectProps === null
        ? orderCallProps(ctx, rowComponent, propEntries)
        : positionalPropsFromEntries();
  }

  const updateStatements: t.Statement[] = [
    astFactory.expressionStatement(
      astFactory.assignmentExpression(
        '=',
        cloneEstreeNode(site.itemPattern, true),
        cloneEstreeNode(nextItem),
      ),
    ),
  ];
  if (nextIndex !== null && site.indexParam !== null) {
    updateStatements.push(
      astFactory.expressionStatement(
        astFactory.assignmentExpression(
          '=',
          astFactory.identifier(site.indexParam),
          cloneEstreeNode(nextIndex),
        ),
      ),
    );
  }
  let nextCallProps = callProps.map((prop) => cloneEstreeNode(prop));
  if (propObjectExpression !== null) {
    const nextProps = generatedIdentifier(ctx, `next${rowComponent}Props`);
    updateStatements.push(
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          cloneEstreeNode(nextProps),
          cloneEstreeNode(propObjectExpression),
        ),
      ]),
    );
    nextCallProps =
      positionalObjectProps === null
        ? callPropsFromObject(ctx, rowComponent, nextProps)
        : positionalPropsFromObject(nextProps);
  }

  const result = generatedIdentifier(
    ctx,
    lightweight ? 'entry' : 'rowElement',
  );
  const needsUpdateProps =
    callProps.length > 0 || rowScope.updaters.length > 0;
  const reuseLightweightEntry = lightweight && needsUpdateProps;
  const lightweightPushProps = reuseLightweightEntry
    ? generatedIdentifier(ctx, 'pushRowProps')
    : null;
  if (lightweight) {
    updateStatements.push(
      astFactory.expressionStatement(
        astFactory.callExpression(
          lightweightPushProps === null
            ? astFactory.memberExpression(
                cloneEstreeNode(result),
                astFactory.identifier('updateProps'),
              )
            : cloneEstreeNode(lightweightPushProps),
          nextCallProps,
        ),
      ),
    );
  } else {
    updateStatements.push(
      astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'setProps'), [
          cloneEstreeNode(rowId),
          astFactory.arrayExpression(nextCallProps),
        ]),
      ),
      astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'markDirty'), [cloneEstreeNode(rowId)]),
      ),
    );
  }
  if (rowScope.updaters.length > 0) {
    updateStatements.push(
      astFactory.expressionStatement(
        astFactory.callExpression(astFactory.identifier(rowScope.updateVar), []),
      ),
    );
  }

  return buildComponentRowFactory({
    ctx,
    site,
    rowComponent,
    rowId,
    nextItem,
    nextIndex,
    rowRefresh,
    rowScope,
    result,
    lightweight,
    needsUpdateProps,
    reuseLightweightEntry,
    lightweightPushProps,
    ownerId,
    eventBindings,
    prefixStatements,
    callProps,
    updateStatements,
  });
}
