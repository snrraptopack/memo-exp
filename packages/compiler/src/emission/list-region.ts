import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode as cloneEstreeNode,
} from '../ast';
import {
  type ComponentPath,
  type Ctx,
  type RowCtx,
  freshReasonConst,
} from '../context';
import {
  componentId,
  generatedIdentifier,
  md,
} from '../identifiers';
import { allocateMapSite, type MapCallExpression, type MapSite } from '../lists';
import { isLightweightRowComponent } from '../analysis';
import { type EmitScope } from './scope';
import type { NodeEmitter } from './node-emitter';
import { hostJsxEventNames } from '../jsx/events';
import { buildComponentRowCreate } from './list-component-row';
import { buildInlineRowCreate } from './list-inline-row';
import {
  buildTargetedListUpdate,
  moduleListSelectionSetup,
  runtimeListSource,
} from './list-update';
import type { AuthoredChildrenSlotBuilder } from './authored-slots';
import { preparationRead } from '../data-sources';

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
  const plan = scope.listSites!.listFor(call, scope.regionShapes!.listCallbackFor(call),
    parentRow === undefined ? undefined : {
      itemParam: parentRow.itemParam, sourceKey: parentRow.sourceKey, sourceLocal: parentRow.sourceLocal ?? false,
    });
  const site = allocateMapSite(call, plan, componentName, scope.usedPrefixes);
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
          scope,
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
          ctx.lightweightInlineRows.has(call),
          scope,
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
    site.form === 'component' && isLightweightRowComponent(ctx, site.rowComp!) ||
    site.form === 'inline' && ctx.lightweightInlineRows.has(call)
  ) {
    if (args.length === 3) args.push(astFactory.identifier('undefined'));
    args.push(astFactory.booleanLiteral(false));
  }
  if (args.length === 3) args.push(astFactory.identifier('undefined'));
  if (args.length === 4) args.push(astFactory.booleanLiteral(true));
  args.push(astFactory.booleanLiteral(site.indexParam !== null));
  const domOnlyComponent = site.form === 'component' && site.prelude.length === 0 &&
    isLightweightRowComponent(ctx, site.rowComp!) &&
    (ctx.domOnlyRowComponents.has(site.rowComp!) ||
      ctx.importedComponents.get(site.rowComp!)?.listResourceFree === true) &&
    site.jsx!.openingElement.attributes.every(attribute =>
      !astFactory.isJSXSpreadAttribute(attribute) &&
      (attribute.name as t.JSXIdentifier).name !== 'ref');
  if (site.form === 'inline' && ctx.lightweightInlineRows.has(call) || domOnlyComponent) {
    args.push(astFactory.booleanLiteral(true));
  }
  scope.creation.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        astFactory.identifier(regionVariable),
        astFactory.callExpression(md(ctx, 'createListRegion'), args),
      ),
    ]),
  );
  scope.disposableRegions.push(regionVariable);
  scope.creation.push(...moduleListSelectionSetup(ctx, ownerId, site.suffix, regionVariable,
    ctx.moduleListSelections.get(call) ?? []));

  const targeted = ctx.targetedListDependencies.get(call) ?? [];
  const mutation = scope.listSites!.mutationFor(call);
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
  const { structuralSource, fixedPositions, moduleIndices, ownerStructuralReason, ownerProvenance } = scope.regionReplay!.listFor(call, {
    sourceExpr: site.sourceExpr, sourceKey: site.sourceKey, sourceLocal: site.sourceLocal,
    hasPrelude: site.prelude.length > 0,
  });
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

  // Use one read identity for creation and every structural replay. A settled
  // module list can discover child-owned resources in the same generation.
  const preparedSource = preparationRead(ctx, scope, ownerId, site.sourceExpr);
  // The closed-record proof excludes replacement, structural writes, escapes,
  // accessors and mutable key fields. Content still replays on opaque pulls.
  const structuralUpdate = (): t.Expression => {
    if (scope.reasonVar === null) return astFactory.booleanLiteral(false);
    const reason = ownerStructuralReason === undefined ? astFactory.callExpression(md(ctx, 'isStructuralListUpdate'), [
      astFactory.identifier(scope.reasonVar), astFactory.stringLiteral(structuralSource),
    ]) : astFactory.callExpression(md(ctx, 'reasonsOnly'), [
      astFactory.identifier(scope.reasonVar), freshReasonConst(ctx, [ownerStructuralReason]),
    ]);
    return ownerProvenance === undefined ? reason : astFactory.logicalExpression('&&',
      astFactory.memberExpression(astFactory.identifier(ownerProvenance), astFactory.identifier('valid')), reason,
    );
  };
  const reconcile = (update = false): t.Statement =>
    astFactory.expressionStatement(
      astFactory.callExpression(
        astFactory.memberExpression(
          astFactory.identifier(regionVariable),
          astFactory.identifier('reconcile'),
        ),
        [
          runtimeListSource(preparedSource, site.optional),
          ...(update && (fixedPositions || scope.reasonVar !== null && site.prelude.length === 0)
            ? [
                structuralUpdate(),
              ]
            : []),
          ...(update && fixedPositions
            ? [astFactory.booleanLiteral(false), astFactory.booleanLiteral(true)]
            : []),
        ],
      ),
    );
  scope.creation.push(reconcile());
  const generalReplay = (): t.Statement => {
    if (scope.reasonVar === null || !moduleIndices) {
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
          [runtimeListSource(preparedSource, site.optional), indices, astFactory.booleanLiteral(true)],
        ))),
    ]);
  };
  if (
    dependencyCaches.length === 0 && mutation === undefined ||
    scope.reasonVar === null
  ) {
    scope.updaters.push(generalReplay);
  } else {
    scope.updaters.push(() =>
      buildTargetedListUpdate(
        ctx,
        componentName,
        scope.reasonVar!,
        regionVariable,
        dependencyCaches,
        mutation,
        generalReplay(),
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
