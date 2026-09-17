import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode as cloneEstreeNode,
} from '../ast';
import {
  canonicalStateKey,
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
import { type EmitScope } from './scope';
import type { NodeEmitter } from './node-emitter';
import { hostJsxEventNames } from '../jsx/events';
import { buildComponentRowCreate } from './list-component-row';
import { buildInlineRowCreate } from './list-inline-row';
import {
  buildTargetedListUpdate,
  runtimeListSource,
} from './list-update';
import type { AuthoredChildrenSlotBuilder } from './authored-slots';

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
  } else if (site.keyExpr !== null && site.keyFromSpread) {
    // The key may come from a spread attribute; destructure the raw item so
    // a nullish merged key falls back to item identity like an absent key.
    const keyItem = generatedIdentifier(ctx, 'keyItem');
    const keyIndex = generatedIdentifier(ctx, 'keyIndex');
    args.push(
      astFactory.arrowFunctionExpression(
        [keyItem, keyIndex],
        astFactory.blockStatement([
          astFactory.variableDeclaration('const', [
            astFactory.variableDeclarator(
              cloneEstreeNode(site.itemPattern, true),
              cloneEstreeNode(keyItem),
            ),
            ...(site.indexParam === null
              ? []
              : [
                  astFactory.variableDeclarator(
                    astFactory.identifier(site.indexParam),
                    cloneEstreeNode(keyIndex),
                  ),
                ]),
          ]),
          astFactory.returnStatement(
            astFactory.logicalExpression(
              '??',
              cloneEstreeNode(site.keyExpr),
              cloneEstreeNode(keyItem),
            ),
          ),
        ]),
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
    scope.updaters.push(() => {
      if (scope.reasonVar === null || site.sourceLocal ||
          !astFactory.isIdentifier(site.sourceExpr) || !ctx.moduleListTargets.has(site.sourceExpr.name)) {
        return reconcile(true);
      }
      const indices = generatedIdentifier(ctx, 'rowIndices');
      return astFactory.blockStatement([
        astFactory.variableDeclaration('const', [astFactory.variableDeclarator(indices,
          astFactory.callExpression(md(ctx, 'listItemIndices'), [
            astFactory.identifier(scope.reasonVar), astFactory.stringLiteral(structuralSource),
          ]))]),
        astFactory.ifStatement(astFactory.binaryExpression('===', indices, astFactory.nullLiteral()),
          reconcile(true),
          astFactory.expressionStatement(astFactory.callExpression(
            astFactory.memberExpression(astFactory.identifier(regionVariable), astFactory.identifier('refreshIndices')),
            [runtimeListSource(site.sourceExpr, site.optional), indices, astFactory.booleanLiteral(true)],
          ))),
      ]);
    });
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
