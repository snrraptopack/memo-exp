import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  attrExpr,
  keyPathOf,
  nodeHasJsx,
  type Ctx,
  type RowCtx,
} from '../context';
import {
  componentId,
  generatedIdentifier,
  md,
} from '../identifiers';
import { analyzeMapSite, type MapSite } from '../lists';
import { isLightweightListedComponent } from '../analysis';
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
  registerStmt,
  updateDecl,
  type EmitScope,
} from './scope';
import type { NodeEmitter } from './node-emitter';
import { compileRefValue } from '../jsx/refs';
import { applyRepeatedDomTemplate } from './dom-template';
import {
  instrumentComponentCallback,
  resolveLocalHelper,
} from '../handlers';
import type {
  KeyedListMutationPlan,
  TargetedListDependency,
} from '../context';
import { hostJsxEventNames } from '../jsx/events';

export type AuthoredChildrenSlotBuilder = (
  ctx: Ctx,
  ownerScope: EmitScope,
  children: readonly JsxChild[],
  componentName: string,
  componentPath: NodePath<t.FunctionDeclaration>,
  nestedIn: 'row' | 'cond' | null,
  rowContext: RowCtx | undefined,
  eventOriginId: t.Expression | undefined,
  inSvg: boolean,
  ownerId: t.Expression,
) => t.Identifier;

/** Emit a keyed list region and its row factory. */
export function emitListRegion(
  ctx: Ctx,
  scope: EmitScope,
  call: t.CallExpression,
  parentElementVariable: string,
  componentName: string,
  componentPath: NodePath<t.FunctionDeclaration>,
  emitNode: NodeEmitter,
  buildAuthoredChildrenSlot: AuthoredChildrenSlotBuilder,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, componentName),
  parentRow?: RowCtx,
): void {
  const site = analyzeMapSite(
    ctx,
    call,
    componentPath,
    componentName,
    scope.usedPrefixes,
    parentRow === undefined
      ? undefined
      : {
          itemParam: parentRow.itemParam,
          sourceKey: parentRow.sourceKey,
          sourceLocal: parentRow.sourceLocal ?? false,
        },
  );
  const regionVariable = generatedIdentifier(
    ctx,
    `region${scope.regionCounter++}`,
  ).name;
  const eventBindings = new Map<string, t.Identifier>();
  const eventNames =
    site.form === 'inline'
      ? hostJsxEventNames(site.jsx!)
      : site.form === 'component' &&
          isLightweightListedComponent(ctx, site.rowComp!)
        ? (ctx.importedComponents.get(site.rowComp!)?.delegatedEvents ??
          (ctx.componentHostEvents.get(site.rowComp!) ?? []))
        : [];
  for (const eventName of eventNames) {
    const binding = generatedIdentifier(ctx, `${eventName}Binding`);
    eventBindings.set(eventName, binding);
    scope.creation.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.cloneNode(binding),
          t.callExpression(md(ctx, 'createDelegatedEventBinding'), [
            t.identifier(parentElementVariable),
            t.stringLiteral(eventName),
          ]),
        ),
      ]),
    );
  }
  const createFactory =
    site.form === 'callback'
      ? buildCallbackRowCreate(ctx, site)
      : site.form === 'component'
      ? buildComponentRowCreate(
          ctx,
          site,
          componentName,
          componentPath,
          buildAuthoredChildrenSlot,
          inSvg,
          ownerId,
          eventBindings,
        )
      : buildInlineRowCreate(
          ctx,
          site,
          componentName,
          componentPath,
          emitNode,
          inSvg,
          ownerId,
          eventBindings,
        );

  const args: t.Expression[] = [
    t.identifier(parentElementVariable),
    t.binaryExpression(
      '+',
      t.cloneNode(ownerId),
      t.stringLiteral(`/${site.suffix}`),
    ),
    createFactory,
  ];
  if (site.form === 'callback') {
    const keyTarget = t.memberExpression(
      t.cloneNode(site.renderCallback!, true),
      t.identifier('key'),
    );
    args.push(
      t.arrowFunctionExpression(
        [
          t.cloneNode(site.itemPattern, true),
          ...(site.indexParam === null
            ? []
            : [t.identifier(site.indexParam)]),
        ],
        t.conditionalExpression(
          t.binaryExpression('==', t.cloneNode(keyTarget), t.nullLiteral()),
          t.cloneNode(site.itemPattern, true) as t.Expression,
          t.callExpression(t.cloneNode(keyTarget), [
            t.cloneNode(site.itemPattern, true) as t.Expression,
            ...(site.indexParam === null
              ? []
              : [t.identifier(site.indexParam)]),
          ]),
        ),
      ),
    );
  } else if (site.keyExpr !== null) {
    args.push(
      t.arrowFunctionExpression(
        [
          t.cloneNode(site.itemPattern, true),
          ...(site.indexParam === null
            ? []
            : [t.identifier(site.indexParam)]),
        ],
        t.cloneNode(site.keyExpr),
      ),
    );
  }
  if (
    site.form === 'component' &&
    isLightweightListedComponent(ctx, site.rowComp!)
  ) {
    if (args.length === 3) args.push(t.identifier('undefined'));
    args.push(t.booleanLiteral(false));
  }
  scope.creation.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(regionVariable),
        t.callExpression(md(ctx, 'createListRegion'), args),
      ),
    ]),
  );
  scope.disposableRegions.push(regionVariable);

  const targeted = ctx.targetedListDependencies.get(call) ?? [];
  const mutation = ctx.keyedListMutations.get(call);
  if (mutation !== undefined) {
    scope.creation.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier(mutation.keysVariable),
          t.newExpression(t.identifier('Set'), []),
        ),
      ]),
    );
  }
  const dependencyCaches = targeted.map((dependency) => ({
    dependency,
    cache: generatedIdentifier(ctx, `${dependency.value}ListKey`).name,
  }));
  if (dependencyCaches.length > 0) {
    scope.creation.push(
      t.variableDeclaration(
        'let',
        dependencyCaches.map(({ dependency, cache }) =>
          t.variableDeclarator(
            t.identifier(cache),
            t.identifier(dependency.value),
          ),
        ),
      ),
    );
  }

  const reconcile = (): t.Statement =>
    t.expressionStatement(
      t.callExpression(
        t.memberExpression(
          t.identifier(regionVariable),
          t.identifier('reconcile'),
        ),
        [t.cloneNode(site.sourceExpr)],
      ),
    );
  scope.creation.push(reconcile());
  if (
    dependencyCaches.length === 0 && mutation === undefined ||
    scope.reasonVar === null
  ) {
    scope.updaters.push(reconcile);
  } else {
    scope.updaters.push(() =>
      buildTargetedListUpdate(
        ctx,
        componentName,
        scope.reasonVar!,
        regionVariable,
        site.sourceExpr,
        dependencyCaches,
        mutation,
        site.indexParam === null,
      ),
    );
  }
}

function hasReason(reasonVar: string, reason: number): t.Expression {
  const current = (): t.Identifier => t.identifier(reasonVar);
  const reasonNode = (): t.Expression => t.valueToNode(reason) as t.Expression;
  return t.logicalExpression(
    '||',
    t.binaryExpression('===', current(), reasonNode()),
    t.logicalExpression(
      '&&',
      t.binaryExpression('!==', current(), t.nullLiteral()),
      t.logicalExpression(
        '&&',
        t.binaryExpression(
          '!==',
          t.unaryExpression('typeof', current()),
          t.stringLiteral('number'),
        ),
        t.callExpression(
          t.memberExpression(current(), t.identifier('has')),
          [reasonNode()],
        ),
      ),
    ),
  );
}

function refreshKey(
  regionVariable: string,
  value: t.Expression,
): t.Statement {
  return t.expressionStatement(
    t.callExpression(
      t.memberExpression(
        t.identifier(regionVariable),
        t.identifier('refreshKey'),
      ),
      [value],
    ),
  );
}

function buildTargetedListUpdate(
  ctx: Ctx,
  componentName: string,
  reasonVar: string,
  regionVariable: string,
  sourceExpr: t.Expression,
  dependencies: Array<{
    dependency: TargetedListDependency;
    cache: string;
  }>,
  mutation: KeyedListMutationPlan | undefined,
  allowTopologyOnly: boolean,
): t.Statement {
  const ownerReasons = ctx.instanceReasonIds.get(componentName);
  if (ownerReasons === undefined) {
    return t.expressionStatement(
      t.callExpression(
        t.memberExpression(
          t.identifier(regionVariable),
          t.identifier('reconcile'),
        ),
        [t.cloneNode(sourceExpr)],
      ),
    );
  }
  const source = mutation?.source ?? dependencies[0]?.dependency.source;
  const sourceReason =
    source === undefined ? undefined : ownerReasons.get(source);
  if (sourceReason === undefined) {
    return t.expressionStatement(
      t.callExpression(
        t.memberExpression(
          t.identifier(regionVariable),
          t.identifier('reconcile'),
        ),
        [t.cloneNode(sourceExpr)],
      ),
    );
  }

  const fullBody: t.Statement[] = [
    t.expressionStatement(
      t.callExpression(
        t.memberExpression(
          t.identifier(regionVariable),
          t.identifier('reconcile'),
        ),
        [t.cloneNode(sourceExpr)],
      ),
    ),
    ...dependencies.map(({ dependency, cache }) =>
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.identifier(cache),
          t.identifier(dependency.value),
        ),
      ),
    ),
    ...(mutation === undefined
      ? []
      : [
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(
                t.identifier(mutation.keysVariable),
                t.identifier('clear'),
              ),
              [],
            ),
          ),
        ]),
  ];
  let topologyOnly: t.Statement | null = null;
  if (mutation !== undefined && allowTopologyOnly) {
    const topologyReason = ownerReasons.get(mutation.topologyReason);
    if (topologyReason !== undefined) {
      let topologyCondition = hasReason(reasonVar, topologyReason);
      for (const reason of [
        ownerReasons.get(mutation.targetedReason),
        ownerReasons.get(mutation.structuralReason),
        ...dependencies.map(({ dependency }) =>
          ownerReasons.get(dependency.value),
        ),
      ]) {
        if (reason === undefined) continue;
        topologyCondition = t.logicalExpression(
          '&&',
          topologyCondition,
          t.unaryExpression('!', hasReason(reasonVar, reason)),
        );
      }
      topologyOnly = t.ifStatement(
        topologyCondition,
        t.blockStatement([
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(
                t.identifier(regionVariable),
                t.identifier('reconcile'),
              ),
              [t.cloneNode(sourceExpr), t.booleanLiteral(false)],
            ),
          ),
        ]),
      );
    }
  }
  const targetedBody: t.Statement[] = [];
  if (mutation !== undefined) {
    const targetedReason = ownerReasons.get(mutation.targetedReason);
    if (targetedReason !== undefined) {
      const key = generatedIdentifier(ctx, 'changedListKey');
      targetedBody.push(
        t.ifStatement(
          hasReason(reasonVar, targetedReason),
          t.blockStatement([
            t.forOfStatement(
              t.variableDeclaration('const', [
                t.variableDeclarator(t.cloneNode(key)),
              ]),
              t.identifier(mutation.keysVariable),
              t.blockStatement([
                refreshKey(regionVariable, t.cloneNode(key)),
              ]),
            ),
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.identifier(mutation.keysVariable),
                  t.identifier('clear'),
                ),
                [],
              ),
            ),
          ]),
        ),
      );
    }
  }
  for (const { dependency, cache } of dependencies) {
    const dependencyReason = ownerReasons.get(dependency.value);
    if (dependencyReason === undefined) continue;
    const previous = generatedIdentifier(ctx, 'previousListKey');
    targetedBody.push(
      t.ifStatement(
        hasReason(reasonVar, dependencyReason),
        t.blockStatement([
          t.variableDeclaration('const', [
            t.variableDeclarator(previous, t.identifier(cache)),
          ]),
          t.expressionStatement(
            t.assignmentExpression(
              '=',
              t.identifier(cache),
              t.identifier(dependency.value),
            ),
          ),
          refreshKey(regionVariable, t.cloneNode(previous)),
          t.ifStatement(
            t.unaryExpression(
              '!',
              t.callExpression(
                t.memberExpression(
                  t.identifier('Object'),
                  t.identifier('is'),
                ),
                [t.cloneNode(previous), t.identifier(cache)],
              ),
            ),
            refreshKey(regionVariable, t.identifier(cache)),
          ),
        ]),
      ),
    );
  }
  let fullCondition: t.Expression = t.binaryExpression(
    '===',
    t.identifier(reasonVar),
    t.nullLiteral(),
  );
  fullCondition = t.logicalExpression(
    '||',
    fullCondition,
    hasReason(reasonVar, -1),
  );
  if (mutation !== undefined) {
    const structuralReason = ownerReasons.get(mutation.structuralReason);
    const topologyReason = ownerReasons.get(mutation.topologyReason);
    const targetedReason = ownerReasons.get(mutation.targetedReason);
    if (structuralReason !== undefined) {
      fullCondition = t.logicalExpression(
        '||',
        fullCondition,
        hasReason(reasonVar, structuralReason),
      );
    }
    if (topologyReason !== undefined) {
      fullCondition = t.logicalExpression(
        '||',
        fullCondition,
        hasReason(reasonVar, topologyReason),
      );
    }
    fullCondition = t.logicalExpression(
      '||',
      fullCondition,
      targetedReason === undefined
        ? hasReason(reasonVar, sourceReason)
        : t.logicalExpression(
            '&&',
            hasReason(reasonVar, sourceReason),
            t.unaryExpression('!', hasReason(reasonVar, targetedReason)),
          ),
    );
  } else {
    fullCondition = t.logicalExpression(
      '||',
      fullCondition,
      hasReason(reasonVar, sourceReason),
    );
  }
  const generalUpdate = t.ifStatement(
    fullCondition,
    t.blockStatement(fullBody),
    targetedBody.length === 0 ? undefined : t.blockStatement(targetedBody),
  );
  if (topologyOnly === null) return generalUpdate;
  topologyOnly.alternate = generalUpdate;
  return topologyOnly;
}

function buildCallbackRowCreate(
  ctx: Ctx,
  site: MapSite,
): t.ArrowFunctionExpression {
  const rowId = generatedIdentifier(ctx, 'renderRowId');
  return t.arrowFunctionExpression(
    [
      t.cloneNode(site.itemPattern, true),
      t.cloneNode(rowId),
      ...(site.indexParam === null
        ? []
        : [t.identifier(site.indexParam)]),
    ],
    t.callExpression(
      t.memberExpression(
        t.cloneNode(site.renderCallback!, true),
        t.identifier('create'),
      ),
      [
        t.cloneNode(site.itemPattern, true) as t.Expression,
        t.cloneNode(rowId),
        ...(site.indexParam === null
          ? []
          : [t.identifier(site.indexParam)]),
      ],
    ),
  );
}

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
        t.objectProperty(
          t.identifier('nodes'),
          t.memberExpression(t.cloneNode(result), t.identifier('nodes')),
        ),
        t.objectProperty(t.identifier('entities'), t.arrayExpression([])),
        t.objectProperty(
          t.identifier('update'),
          t.memberExpression(t.cloneNode(result), t.identifier('update')),
        ),
        t.objectProperty(
          t.identifier('dispose'),
          t.memberExpression(t.cloneNode(result), t.identifier('dispose')),
        ),
      ]
    : [
        t.objectProperty(
          t.identifier('nodes'),
          t.callExpression(md(ctx, 'rootNodes'), [t.cloneNode(result)]),
        ),
        t.objectProperty(
          t.identifier('entities'),
          t.arrayExpression([t.cloneNode(rowId)]),
        ),
      ];
  if (needsUpdateProps && !reuseLightweightEntry) {
    entryProperties.push(
      t.objectProperty(
        t.identifier('updateProps'),
        t.arrowFunctionExpression(
          [
            t.cloneNode(nextItem),
            ...(nextIndex === null ? [] : [t.cloneNode(nextIndex)]),
          ],
          t.blockStatement(updateStatements),
        ),
      ),
    );
  }

  return t.arrowFunctionExpression(
    [
      t.cloneNode(site.itemPattern, true),
      t.cloneNode(rowId),
      ...(site.indexParam === null ? [] : [t.identifier(site.indexParam)]),
    ],
    t.blockStatement([
      ...(rowScope.updaters.length > 0
        ? [cacheDecl(rowScope), updateDecl(rowScope)]
        : []),
      ...rowScope.creation,
      ...rowScope.mounts,
      ...prefixStatements,
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.cloneNode(result),
          lightweight
            ? t.callExpression(t.identifier(rowComponent), [
                ...callProps.map((prop) => t.cloneNode(prop)),
                t.cloneNode(rowId),
                ...(site.sourceLocal ? [t.cloneNode(ownerId)] : []),
                ...[...eventBindings.values()].map((binding) =>
                  t.cloneNode(binding),
                ),
              ])
            : t.callExpression(t.identifier(rowComponent), [
                t.cloneNode(rowId),
                t.cloneNode(ownerId),
                ...(callProps.length > 0
                  ? [t.arrayExpression(callProps)]
                  : []),
              ]),
        ),
      ]),
      ...(rowScope.updaters.length > 0
        ? [
            t.variableDeclaration('const', [
              t.variableDeclarator(
                t.cloneNode(rowRefresh),
                t.arrowFunctionExpression(
                  [],
                  t.blockStatement([
                    t.expressionStatement(
                      lightweight
                        ? t.callExpression(
                            t.memberExpression(
                              t.cloneNode(result),
                              t.identifier('update'),
                            ),
                            [],
                          )
                        : t.callExpression(md(ctx, 'markDirty'), [
                            t.cloneNode(rowId),
                          ]),
                    ),
                    t.expressionStatement(
                      t.callExpression(t.identifier(rowScope.updateVar), []),
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
            t.variableDeclaration('const', [
              t.variableDeclarator(
                t.cloneNode(lightweightPushProps),
                t.memberExpression(
                  t.cloneNode(result),
                  t.identifier('updateProps'),
                ),
              ),
            ]),
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.memberExpression(
                  t.cloneNode(result),
                  t.identifier('updateProps'),
                ),
                t.arrowFunctionExpression(
                  [
                    t.cloneNode(nextItem),
                    ...(nextIndex === null ? [] : [t.cloneNode(nextIndex)]),
                  ],
                  t.blockStatement(updateStatements),
                ),
              ),
            ),
          ]),
      t.returnStatement(
        reuseLightweightEntry
          ? t.cloneNode(result)
          : t.objectExpression(entryProperties),
      ),
    ]),
  );
}

function buildComponentRowCreate(
  ctx: Ctx,
  site: MapSite,
  componentName: string,
  componentPath: NodePath<t.FunctionDeclaration>,
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
  const lightweight = isLightweightListedComponent(ctx, rowComponent);
  const rowContext: RowCtx = {
    itemParam: site.itemParam,
    itemPath: [],
    rowIdVar: rowId.name,
    refreshVar: rowRefresh.name,
    keyPath: keyPathOf(site.keyExpr, site.itemParam),
    sourceKey: site.sourceKey,
    sourceLocal: site.sourceLocal,
    ...(site.sourceLocal && t.isIdentifier(ownerId)
      ? { ownerIdVar: ownerId.name }
      : {}),
  };
  const attributes = site.jsx!.openingElement.attributes.filter(
    (attribute) =>
      t.isJSXSpreadAttribute(attribute) ||
      jsxAttributeName(attribute.name) !== 'key',
  );
  const hasSpread = attributes.some((attribute) =>
    t.isJSXSpreadAttribute(attribute),
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
      t.cloneNode(byName.get(name) ?? t.identifier('undefined')),
    );
  };
  const positionalPropsFromObject = (
    object: t.Expression,
  ): t.Expression[] =>
    positionalObjectProps!.map(({ name }) =>
      t.memberExpression(
        t.cloneNode(object),
        t.isValidIdentifier(name)
          ? t.identifier(name)
          : t.stringLiteral(name),
        !t.isValidIdentifier(name),
      ),
    );
  const renderValueSlot = (value: t.Expression): t.Identifier => {
    const children: JsxChild[] =
      t.isJSXElement(value) || t.isJSXFragment(value)
        ? [value]
        : [t.jsxExpressionContainer(value)];
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
        !t.isObjectProperty(property) ||
        property.computed ||
        !t.isExpression(property.value)
      ) {
        continue;
      }
      const propName = t.isIdentifier(property.key)
        ? property.key.name
        : t.isStringLiteral(property.key)
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
        direct.value == null ? t.booleanLiteral(true) : attrExpr(direct.value);
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
            value: t.cloneNode(value),
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
      } else if (t.isIdentifier(value)) {
        const localFn = resolveLocalHelper(componentPath, value.name);
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
          ? stabilizeInlineCallbackStatement(
              ctx,
              prefixStatements,
              value,
              `${propName}Callback`,
            )
          : t.cloneNode(value),
      });
    }
  }

  if (hasComponentChildren(site.jsx!.children)) {
    if (
      attributes.some(
        (attribute) =>
          t.isJSXAttribute(attribute) &&
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
        t.objectProperty(
          t.identifier('children'),
          t.cloneNode(childrenSlot),
        ),
      );
    } else {
      propEntries.push({
        name: 'children',
        value: t.cloneNode(childrenSlot),
      });
    }
  }

  let callProps: t.Expression[];
  if (propObjectExpression !== null) {
    const propObject = generatedIdentifier(ctx, `${rowComponent}Props`);
    prefixStatements.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.cloneNode(propObject),
          t.cloneNode(propObjectExpression),
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
    t.expressionStatement(
      t.assignmentExpression(
        '=',
        t.cloneNode(site.itemPattern, true),
        t.cloneNode(nextItem),
      ),
    ),
  ];
  if (nextIndex !== null && site.indexParam !== null) {
    updateStatements.push(
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.identifier(site.indexParam),
          t.cloneNode(nextIndex),
        ),
      ),
    );
  }
  let nextCallProps = callProps.map((prop) => t.cloneNode(prop));
  if (propObjectExpression !== null) {
    const nextProps = generatedIdentifier(ctx, `next${rowComponent}Props`);
    updateStatements.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.cloneNode(nextProps),
          t.cloneNode(propObjectExpression),
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
      t.expressionStatement(
        t.callExpression(
          lightweightPushProps === null
            ? t.memberExpression(
                t.cloneNode(result),
                t.identifier('updateProps'),
              )
            : t.cloneNode(lightweightPushProps),
          nextCallProps,
        ),
      ),
    );
  } else {
    updateStatements.push(
      t.expressionStatement(
        t.callExpression(md(ctx, 'setProps'), [
          t.cloneNode(rowId),
          t.arrayExpression(nextCallProps),
        ]),
      ),
      t.expressionStatement(
        t.callExpression(md(ctx, 'markDirty'), [t.cloneNode(rowId)]),
      ),
    );
  }
  if (rowScope.updaters.length > 0) {
    updateStatements.push(
      t.expressionStatement(
        t.callExpression(t.identifier(rowScope.updateVar), []),
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

function buildInlineRowCreate(
  ctx: Ctx,
  site: MapSite,
  componentName: string,
  componentPath: NodePath<t.FunctionDeclaration>,
  emitNode: NodeEmitter,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, componentName),
  eventBindings: ReadonlyMap<string, t.Identifier> = new Map(),
): t.ArrowFunctionExpression {
  site.jsx!.openingElement.attributes =
    site.jsx!.openingElement.attributes.filter(
      (attribute) =>
        t.isJSXSpreadAttribute(attribute) ||
        (attribute.name as t.JSXIdentifier).name !== 'key',
    );
  const rowScope = newEmitScope(ctx);
  for (const [eventName, binding] of eventBindings) {
    rowScope.delegatedEventBindings.set(eventName, binding.name);
  }
  const rowId = generatedIdentifier(ctx, 'rowId').name;
  const nextItem = generatedIdentifier(ctx, 'nextItem');
  const nextIndex =
    site.indexParam === null ? null : generatedIdentifier(ctx, 'nextIndex');
  const rowContext: RowCtx = {
    itemParam: site.itemParam,
    itemPath: [],
    rowIdVar: rowId,
    keyPath: keyPathOf(site.keyExpr, site.itemParam),
    sourceKey: site.sourceKey,
    sourceLocal: site.sourceLocal,
    ...(site.sourceLocal
      ? {
          ownerIdVar: t.isIdentifier(ownerId)
            ? ownerId.name
            : componentId(ctx, componentName).name,
        }
      : {}),
  };
  const rootVariable = emitNode(
    ctx,
    rowScope,
    site.jsx!,
    componentName,
    componentPath,
    'row',
    rowContext,
    t.identifier(rowId),
    inSvg,
    t.identifier(rowId),
  );
  applyRepeatedDomTemplate(ctx, rowScope, rootVariable);
  const bindingUpdates: t.Statement[] =
    [
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.cloneNode(site.itemPattern, true),
          t.cloneNode(nextItem),
        ),
      ),
    ];
  if (nextIndex !== null && site.indexParam !== null) {
    bindingUpdates.push(
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.identifier(site.indexParam),
          t.cloneNode(nextIndex),
        ),
      ),
    );
  }

  return t.arrowFunctionExpression(
    [
      t.cloneNode(site.itemPattern, true),
      t.identifier(rowId),
      ...(site.indexParam === null
        ? []
        : [t.identifier(site.indexParam)]),
    ],
    t.blockStatement([
      cacheDecl(rowScope),
      updateDecl(rowScope),
      registerStmt(
        ctx,
        t.identifier(rowId),
        t.cloneNode(ownerId),
        t.identifier(rowScope.updateVar),
      ),
      ...rowScope.creation,
      ...rowScope.mounts,
      t.returnStatement(
        t.objectExpression([
          t.objectProperty(
            t.identifier('nodes'),
            t.arrayExpression([t.identifier(rootVariable)]),
          ),
          t.objectProperty(
            t.identifier('entities'),
            t.arrayExpression([t.identifier(rowId)]),
          ),
          t.objectProperty(
            t.identifier('updateProps'),
            t.arrowFunctionExpression(
              [
                t.cloneNode(nextItem),
                ...(nextIndex === null
                  ? []
                  : [t.cloneNode(nextIndex)]),
              ],
              t.blockStatement(bindingUpdates),
            ),
          ),
          t.objectProperty(
            t.identifier('update'),
            t.identifier(rowScope.updateVar),
          ),
        ]),
      ),
    ]),
  );
}
