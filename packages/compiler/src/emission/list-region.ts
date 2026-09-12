import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode as cloneEstreeNode,
  isValidIdentifier as isValidEstreeIdentifier,
} from '../ast';
import {
  attrExpr,
  canonicalStateKey,
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
import { analyzeMapSite, type MapCallExpression, type MapSite } from '../lists';
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
  componentPath: ComponentPath,
  nestedIn: 'row' | 'cond' | null,
  rowContext: RowCtx | undefined,
  eventOriginId: t.Expression | undefined,
  inSvg: boolean,
  ownerId: t.Expression,
) => t.Identifier;

function runtimeListSource(
  source: t.Expression,
  optional: boolean,
): t.Expression {
  const value = cloneEstreeNode(source);
  return optional
    ? astFactory.logicalExpression('??', value, astFactory.arrayExpression([]))
    : value;
}

/** Emit a keyed list region and its row factory. */
export function emitListRegion(
  ctx: Ctx,
  scope: EmitScope,
  call: MapCallExpression,
  parentElementVariable: string,
  componentName: string,
  componentPath: ComponentPath,
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
          isLightweightRowComponent(ctx, site.rowComp!)
        ? (ctx.importedComponents.get(site.rowComp!)?.delegatedEvents ??
          (ctx.componentHostEvents.get(site.rowComp!) ?? []))
        : [];
  for (const eventName of eventNames) {
    const binding = generatedIdentifier(ctx, `${eventName}Binding`);
    eventBindings.set(eventName, binding);
    scope.creation.push(
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          cloneEstreeNode(binding),
          astFactory.callExpression(md(ctx, 'createDelegatedEventBinding'), [
            astFactory.identifier(parentElementVariable),
            astFactory.stringLiteral(eventName),
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
    astFactory.identifier(parentElementVariable),
    astFactory.binaryExpression(
      '+',
      cloneEstreeNode(ownerId),
      astFactory.stringLiteral(`/${site.suffix}`),
    ),
    createFactory,
  ];
  if (site.form === 'callback') {
    const keyTarget = astFactory.memberExpression(
      cloneEstreeNode(site.renderCallback!, true),
      astFactory.identifier('key'),
    );
    args.push(
      astFactory.arrowFunctionExpression(
        [
          cloneEstreeNode(site.itemPattern, true),
          ...(site.indexParam === null
            ? []
            : [astFactory.identifier(site.indexParam)]),
        ],
        astFactory.conditionalExpression(
          astFactory.binaryExpression('==', cloneEstreeNode(keyTarget), astFactory.nullLiteral()),
          cloneEstreeNode(site.itemPattern, true) as t.Expression,
          astFactory.callExpression(cloneEstreeNode(keyTarget), [
            cloneEstreeNode(site.itemPattern, true) as t.Expression,
            ...(site.indexParam === null
              ? []
              : [astFactory.identifier(site.indexParam)]),
          ]),
        ),
      ),
    );
  } else if (site.keyExpr !== null) {
    args.push(
      astFactory.arrowFunctionExpression(
        [
          cloneEstreeNode(site.itemPattern, true),
          ...(site.indexParam === null
            ? []
            : [astFactory.identifier(site.indexParam)]),
        ],
        cloneEstreeNode(site.keyExpr),
      ),
    );
  }
  if (
    site.form === 'component' &&
    isLightweightRowComponent(ctx, site.rowComp!)
  ) {
    if (args.length === 3) args.push(astFactory.identifier('undefined'));
    args.push(astFactory.booleanLiteral(false));
  }
  if (args.length === 3) args.push(astFactory.identifier('undefined'));
  if (args.length === 4) args.push(astFactory.booleanLiteral(true));
  args.push(astFactory.booleanLiteral(site.indexParam !== null));
  scope.creation.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        astFactory.identifier(regionVariable),
        astFactory.callExpression(md(ctx, 'createListRegion'), args),
      ),
    ]),
  );
  scope.disposableRegions.push(regionVariable);

  const targeted = ctx.targetedListDependencies.get(call) ?? [];
  const mutation = ctx.keyedListMutations.get(call);
  if (mutation !== undefined) {
    scope.creation.push(
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          astFactory.identifier(mutation.keysVariable),
          astFactory.newExpression(astFactory.identifier('Set'), []),
        ),
      ]),
    );
  }
  const dependencyCaches = targeted.map((dependency) => ({
    dependency,
    cache: generatedIdentifier(ctx, `${dependency.value}ListKey`).name,
  }));
  const structuralSource = site.sourceLocal
    ? ''
    : canonicalStateKey(ctx, site.sourceKey);
  if (dependencyCaches.length > 0) {
    scope.creation.push(
      astFactory.variableDeclaration(
        'let',
        dependencyCaches.map(({ dependency, cache }) =>
          astFactory.variableDeclarator(
            astFactory.identifier(cache),
            astFactory.identifier(dependency.value),
          ),
        ),
      ),
    );
  }

  const reconcile = (update = false): t.Statement =>
    astFactory.expressionStatement(
      astFactory.callExpression(
        astFactory.memberExpression(
          astFactory.identifier(regionVariable),
          astFactory.identifier('reconcile'),
        ),
        [
          runtimeListSource(site.sourceExpr, site.optional),
          ...(update && scope.reasonVar !== null
            ? [
                astFactory.callExpression(md(ctx, 'isStructuralListUpdate'), [
                  astFactory.identifier(scope.reasonVar),
                  astFactory.stringLiteral(structuralSource),
                ]),
              ]
            : []),
        ],
      ),
    );
  scope.creation.push(reconcile());
  if (
    dependencyCaches.length === 0 && mutation === undefined ||
    scope.reasonVar === null
  ) {
    scope.updaters.push(() => reconcile(true));
  } else {
    scope.updaters.push(() =>
      buildTargetedListUpdate(
        ctx,
        componentName,
        scope.reasonVar!,
        regionVariable,
        site.sourceExpr,
        site.optional,
        dependencyCaches,
        mutation,
        structuralSource,
      ),
    );
  }
}

function hasReason(reasonVar: string, reason: number): t.Expression {
  const current = (): t.Identifier => astFactory.identifier(reasonVar);
  const reasonNode = (): t.Expression =>
    reason < 0
      ? astFactory.unaryExpression('-', astFactory.numericLiteral(-reason), true)
      : astFactory.numericLiteral(reason);
  return astFactory.logicalExpression(
    '||',
    astFactory.binaryExpression('===', current(), reasonNode()),
    astFactory.logicalExpression(
      '&&',
      astFactory.binaryExpression('!==', current(), astFactory.nullLiteral()),
      astFactory.logicalExpression(
        '&&',
        astFactory.binaryExpression(
          '!==',
          astFactory.unaryExpression('typeof', current()),
          astFactory.stringLiteral('number'),
        ),
        astFactory.callExpression(
          astFactory.memberExpression(current(), astFactory.identifier('has')),
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
  return astFactory.expressionStatement(
    astFactory.callExpression(
      astFactory.memberExpression(
        astFactory.identifier(regionVariable),
        astFactory.identifier('refreshKey'),
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
  optional: boolean,
  dependencies: Array<{
    dependency: TargetedListDependency;
    cache: string;
  }>,
  mutation: KeyedListMutationPlan | undefined,
  structuralSource: string,
): t.Statement {
  const ownerReasons = ctx.instanceReasonIds.get(componentName);
  if (ownerReasons === undefined) {
    return astFactory.expressionStatement(
      astFactory.callExpression(
        astFactory.memberExpression(
          astFactory.identifier(regionVariable),
          astFactory.identifier('reconcile'),
        ),
        [
          runtimeListSource(sourceExpr, optional),
          astFactory.callExpression(md(ctx, 'isStructuralListUpdate'), [
            astFactory.identifier(reasonVar),
            astFactory.stringLiteral(structuralSource),
          ]),
        ],
      ),
    );
  }
  const source = mutation?.source ?? dependencies[0]?.dependency.source;
  const sourceReason =
    source === undefined ? undefined : ownerReasons.get(source);
  if (sourceReason === undefined) {
    return astFactory.expressionStatement(
      astFactory.callExpression(
        astFactory.memberExpression(
          astFactory.identifier(regionVariable),
          astFactory.identifier('reconcile'),
        ),
        [
          runtimeListSource(sourceExpr, optional),
          astFactory.callExpression(md(ctx, 'isStructuralListUpdate'), [
            astFactory.identifier(reasonVar),
            astFactory.stringLiteral(structuralSource),
          ]),
        ],
      ),
    );
  }

  const fullBody: t.Statement[] = [
    astFactory.expressionStatement(
      astFactory.callExpression(
        astFactory.memberExpression(
          astFactory.identifier(regionVariable),
          astFactory.identifier('reconcile'),
        ),
        [
          runtimeListSource(sourceExpr, optional),
          astFactory.callExpression(md(ctx, 'isStructuralListUpdate'), [
            astFactory.identifier(reasonVar),
            astFactory.stringLiteral(structuralSource),
          ]),
        ],
      ),
    ),
    ...dependencies.map(({ dependency, cache }) =>
      astFactory.expressionStatement(
        astFactory.assignmentExpression(
          '=',
          astFactory.identifier(cache),
          astFactory.identifier(dependency.value),
        ),
      ),
    ),
    ...(mutation === undefined
      ? []
      : [
          astFactory.expressionStatement(
            astFactory.callExpression(
              astFactory.memberExpression(
                astFactory.identifier(mutation.keysVariable),
                astFactory.identifier('clear'),
              ),
              [],
            ),
          ),
        ]),
  ];
  const targetedBody: t.Statement[] = [];
  if (mutation !== undefined) {
    const targetedReason = ownerReasons.get(mutation.targetedReason);
    if (targetedReason !== undefined) {
      const key = generatedIdentifier(ctx, 'changedListKey');
      targetedBody.push(
        astFactory.ifStatement(
          hasReason(reasonVar, targetedReason),
          astFactory.blockStatement([
            astFactory.forOfStatement(
              astFactory.variableDeclaration('const', [
                astFactory.variableDeclarator(cloneEstreeNode(key)),
              ]),
              astFactory.identifier(mutation.keysVariable),
              astFactory.blockStatement([
                refreshKey(regionVariable, cloneEstreeNode(key)),
              ]),
            ),
            astFactory.expressionStatement(
              astFactory.callExpression(
                astFactory.memberExpression(
                  astFactory.identifier(mutation.keysVariable),
                  astFactory.identifier('clear'),
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
      astFactory.ifStatement(
        hasReason(reasonVar, dependencyReason),
        astFactory.blockStatement([
          astFactory.variableDeclaration('const', [
            astFactory.variableDeclarator(previous, astFactory.identifier(cache)),
          ]),
          astFactory.expressionStatement(
            astFactory.assignmentExpression(
              '=',
              astFactory.identifier(cache),
              astFactory.identifier(dependency.value),
            ),
          ),
          refreshKey(regionVariable, cloneEstreeNode(previous)),
          astFactory.ifStatement(
            astFactory.unaryExpression(
              '!',
              astFactory.callExpression(
                astFactory.memberExpression(
                  astFactory.identifier('Object'),
                  astFactory.identifier('is'),
                ),
                [cloneEstreeNode(previous), astFactory.identifier(cache)],
              ),
            ),
            refreshKey(regionVariable, astFactory.identifier(cache)),
          ),
        ]),
      ),
    );
  }
  let fullCondition: t.Expression = astFactory.binaryExpression(
    '===',
    astFactory.identifier(reasonVar),
    astFactory.nullLiteral(),
  );
  fullCondition = astFactory.logicalExpression(
    '||',
    fullCondition,
    hasReason(reasonVar, -1),
  );
  if (mutation !== undefined) {
    const structuralReason = ownerReasons.get(mutation.structuralReason);
    const targetedReason = ownerReasons.get(mutation.targetedReason);
    if (structuralReason !== undefined) {
      fullCondition = astFactory.logicalExpression(
        '||',
        fullCondition,
        hasReason(reasonVar, structuralReason),
      );
    }
    fullCondition = astFactory.logicalExpression(
      '||',
      fullCondition,
      targetedReason === undefined
        ? hasReason(reasonVar, sourceReason)
        : astFactory.logicalExpression(
            '&&',
            hasReason(reasonVar, sourceReason),
            astFactory.unaryExpression('!', hasReason(reasonVar, targetedReason)),
          ),
    );
  } else {
    fullCondition = astFactory.logicalExpression(
      '||',
      fullCondition,
      hasReason(reasonVar, sourceReason),
    );
  }
  const generalUpdate = astFactory.ifStatement(
    fullCondition,
    astFactory.blockStatement(fullBody),
    targetedBody.length === 0 ? undefined : astFactory.blockStatement(targetedBody),
  );
  return generalUpdate;
}

function buildCallbackRowCreate(
  ctx: Ctx,
  site: MapSite,
): t.ArrowFunctionExpression {
  const rowId = generatedIdentifier(ctx, 'renderRowId');
  return astFactory.arrowFunctionExpression(
    [
      cloneEstreeNode(site.itemPattern, true),
      cloneEstreeNode(rowId),
      ...(site.indexParam === null
        ? []
        : [astFactory.identifier(site.indexParam)]),
    ],
    astFactory.callExpression(
      astFactory.memberExpression(
        cloneEstreeNode(site.renderCallback!, true),
        astFactory.identifier('create'),
      ),
      [
        cloneEstreeNode(site.itemPattern, true) as t.Expression,
        cloneEstreeNode(rowId),
        ...(site.indexParam === null
          ? []
          : [astFactory.identifier(site.indexParam)]),
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

function buildComponentRowCreate(
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
    ...(site.sourceLocal && astFactory.isIdentifier(ownerId)
      ? { ownerIdVar: ownerId.name }
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

function buildInlineRowCreate(
  ctx: Ctx,
  site: MapSite,
  componentName: string,
  componentPath: ComponentPath,
  emitNode: NodeEmitter,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, componentName),
  eventBindings: ReadonlyMap<string, t.Identifier> = new Map(),
): t.ArrowFunctionExpression {
  site.jsx!.openingElement.attributes =
    site.jsx!.openingElement.attributes.filter(
      (attribute) =>
        astFactory.isJSXSpreadAttribute(attribute) ||
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
          ownerIdVar: astFactory.isIdentifier(ownerId)
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
    astFactory.identifier(rowId),
    inSvg,
    astFactory.identifier(rowId),
  );
  applyRepeatedDomTemplate(ctx, rowScope, rootVariable);
  const bindingUpdates: t.Statement[] =
    [
      astFactory.expressionStatement(
        astFactory.assignmentExpression(
          '=',
          cloneEstreeNode(site.itemPattern, true),
          cloneEstreeNode(nextItem),
        ),
      ),
    ];
  if (nextIndex !== null && site.indexParam !== null) {
    bindingUpdates.push(
      astFactory.expressionStatement(
        astFactory.assignmentExpression(
          '=',
          astFactory.identifier(site.indexParam),
          cloneEstreeNode(nextIndex),
        ),
      ),
    );
  }

  return astFactory.arrowFunctionExpression(
    [
      cloneEstreeNode(site.itemPattern, true),
      astFactory.identifier(rowId),
      ...(site.indexParam === null
        ? []
        : [astFactory.identifier(site.indexParam)]),
    ],
    astFactory.blockStatement([
      cacheDecl(rowScope),
      updateDecl(rowScope),
      ...rowScope.prelude,
      registerStmt(
        ctx,
        astFactory.identifier(rowId),
        cloneEstreeNode(ownerId),
        astFactory.identifier(rowScope.updateVar),
      ),
      ...rowScope.creation,
      ...rowScope.mounts,
      astFactory.returnStatement(
        astFactory.objectExpression([
          astFactory.objectProperty(
            astFactory.identifier('nodes'),
            astFactory.arrayExpression([astFactory.identifier(rootVariable)]),
          ),
          astFactory.objectProperty(
            astFactory.identifier('entities'),
            astFactory.arrayExpression([astFactory.identifier(rowId)]),
          ),
          astFactory.objectProperty(
            astFactory.identifier('updateProps'),
            astFactory.arrowFunctionExpression(
              [
                cloneEstreeNode(nextItem),
                ...(nextIndex === null
                  ? []
                  : [cloneEstreeNode(nextIndex)]),
              ],
              astFactory.blockStatement(bindingUpdates),
            ),
          ),
          astFactory.objectProperty(
            astFactory.identifier('update'),
            astFactory.identifier(rowScope.updateVar),
          ),
        ]),
      ),
    ]),
  );
}
