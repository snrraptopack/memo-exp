/**
 * emission/component.ts - component source functions to runtime factories.
 *
 * This emitter owns the component factory ABI, prop and local-derivation
 * replay order, lifecycle registration, and listed-row identity. DOM and
 * structural-region creation remain in emit.ts.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { isLightweightListedComponent } from '../analysis';
import {
  instanceSourceReasons,
  type ComponentPath,
  type Ctx,
  type RowCtx,
} from '../context';
import { buildBranchCreate, emitNode } from '../emit';
import {
  generatedIdentifier,
  md,
  mdHot,
  mdd,
  requireIdentifiers,
} from '../identifiers';
import { transformComponentLifecycle } from '../lifecycle';
import {
  buildPropDeclaration,
  buildPropReplay,
  runtimeParameter,
  simpleObjectPropBindings,
  type ComponentPropsPlan,
  propReasonArguments,
  type SimpleObjectPropBinding,
} from '../components/props';
import { buildRenderPreludeReplay } from '../components/render-prelude';
import { structuralReasonsFor } from '../components/local-derived';
import type { ComponentReturnPlan } from '../components/return-plan';
import type { PlannedComponent } from '../planning/component-render';
import type { ListedRowPlacement } from '../planning/component-placement';
import {
  buildEffectRegistrations,
  buildLocalEffectInvalidations,
} from '../effects';
import {
  cacheDecl,
  newEmitScope,
  registerStmt,
  renderDocument,
  updateDecl,
} from './scope';
import { applyRepeatedDomTemplate } from './dom-template';
import { prepareServerWriter } from './server-writer';
import { applyStaticMarkup } from './markup';
import { transparentSourceMounts } from '../data-sources';
import { selectedRouteSubscriptionBinding } from '../external-reactivity';
import { routeSelectorExpression } from './route-selectors';

type ComponentEmitScope = ReturnType<typeof newEmitScope>;

function buildComponentRowContext(
  placement: ListedRowPlacement | null,
  lightweight: boolean,
  updateVar: string,
  factoryId: string,
  factoryOwner: string | null,
  factoryParent: string | null,
): RowCtx | undefined {
  if (placement === null) return undefined;
  return {
    itemParam: placement.itemParam,
    itemPath: [...placement.itemPath],
    rowIdVar: factoryId,
    ...(lightweight ? { refreshVar: updateVar } : {}),
    keyPath: placement.keyPath === null ? null : [...placement.keyPath],
    sourceKey: placement.sourceKey,
    sourceLocal: placement.sourceLocal,
    ...(placement.sourceLocal
      ? { ownerIdVar: factoryOwner ?? factoryParent! }
      : {}),
  };
}

function buildLightweightReturn(
  ctx: Ctx,
  scope: ComponentEmitScope,
  propPlan: ComponentPropsPlan,
  positionalObjectProps: readonly SimpleObjectPropBinding[] | null,
  lightweightPropCount: number,
  rootVar: string,
  singleRoot: boolean,
): t.ReturnStatement {
  const nextProps = Array.from({ length: lightweightPropCount }, (_, index) =>
    generatedIdentifier(ctx, `nextProp${index}`),
  );
  const replay = positionalObjectProps === null
    ? buildPropReplay(propPlan, nextProps)
    : positionalObjectProps.map(({ local }, index) =>
        astFactory.expressionStatement(
          astFactory.assignmentExpression(
            '=',
            astFactory.identifier(local),
            cloneEstreeNode(nextProps[index]!),
          ),
        ),
      );
  return astFactory.returnStatement(
    astFactory.objectExpression([
      astFactory.objectProperty(
        astFactory.identifier('nodes'),
        singleRoot
          ? astFactory.identifier(rootVar)
          : astFactory.callExpression(md(ctx, 'rootNodes'), [astFactory.identifier(rootVar)]),
      ),
      astFactory.objectProperty(astFactory.identifier('entities'), astFactory.arrayExpression([])),
      astFactory.objectProperty(astFactory.identifier('update'), astFactory.identifier(scope.updateVar)),
      ...(lightweightPropCount > 0
        ? [
            astFactory.objectProperty(
              astFactory.identifier('updateProps'),
              astFactory.arrowFunctionExpression(nextProps, astFactory.blockStatement(replay)),
            ),
          ]
        : []),
      ...(scope.disposableCallbacks.length > 0
        ? [
            astFactory.objectProperty(
              astFactory.identifier('dispose'),
              astFactory.arrowFunctionExpression(
                [],
                astFactory.blockStatement(
                  [...scope.disposableCallbacks]
                    .reverse()
                    .map((callback) =>
                      astFactory.ifStatement(
                        astFactory.binaryExpression(
                          '!==',
                          cloneEstreeNode(callback),
                          astFactory.nullLiteral(),
                        ),
                        astFactory.expressionStatement(
                          astFactory.callExpression(cloneEstreeNode(callback), []),
                        ),
                      ),
                    ),
                ),
              ),
            ),
          ]
        : []),
    ]),
  );
}

function buildFactoryParameters(
  propPlan: ComponentPropsPlan,
  positionalObjectProps: readonly SimpleObjectPropBinding[] | null,
  lightweight: boolean,
  propSlotCount: number,
  factoryId: string,
  factoryParent: string | null,
  factoryOwner: string | null,
  eventBindings: ReadonlyMap<string, string>,
  propsBox: string | null,
  dataPolicies: t.Identifier | null,
  routeContext: t.Identifier | null,
): t.FunctionDeclaration['params'] {
  if (lightweight) {
    return [
      ...(positionalObjectProps === null
        ? propPlan.params.map(runtimeParameter)
        : positionalObjectProps.map(({ local }) => astFactory.identifier(local))),
      astFactory.identifier(factoryId),
      ...(factoryOwner === null ? [] : [astFactory.identifier(factoryOwner)]),
      ...[...eventBindings.values()].map((binding) => astFactory.identifier(binding)),
    ];
  }
  return propSlotCount > 0
    ? [
        astFactory.identifier(factoryId),
        astFactory.identifier(factoryParent!),
        astFactory.identifier(propsBox!),
        ...(dataPolicies === null ? [] : [cloneEstreeNode(dataPolicies)]),
        ...(routeContext === null ? [] : [cloneEstreeNode(routeContext)]),
      ]
    : [
        astFactory.identifier(factoryId),
        astFactory.identifier(factoryParent!),
        ...(dataPolicies === null ? [] : [cloneEstreeNode(dataPolicies)]),
        ...(routeContext === null ? [] : [cloneEstreeNode(routeContext)]),
      ];
}

export function transformComponent(
  ctx: Ctx,
  component: PlannedComponent,
): void {
  const { source: path, name, returns, expressionSources, placement } = component;
  const node = path.node;
  const propPlan = ctx.componentProps.get(name)!;
  const propSlotCount = propPlan.params.length;
  const { sourceLocal, ownsRoutes, externalSources, routeSelectors, hasLocalEffects } = placement;
  const dataPolicies = ctx.transparentPolicyParams.get(name) ?? null;
  const lightweight =
    dataPolicies === null &&
    !ctx.transparentSources.has(name) &&
    !ownsRoutes &&
    isLightweightListedComponent(ctx, name);
  const positionalObjectProps =
    lightweight && (!placement.hasLinkedRows || ctx.privateRowPropComponents.has(name))
      ? simpleObjectPropBindings(propPlan)
      : null;
  const lightweightPropCount =
    positionalObjectProps?.length ?? propSlotCount;
  const scope = newEmitScope(ctx, lightweight, component);
  const initialComponent=ctx.initialDomComponents[name];
  const initialRoot=initialComponent ? generatedIdentifier(ctx,'initialComponentRoot') : null;
  if (ctx.initialDomRoot?.component === name) {
    scope.initialDom={plan:ctx.initialDomRoot,variable:generatedIdentifier(ctx,'initialNodes').name,descriptors:[]};
  } else if (initialComponent) {
    scope.initialDom={plan:initialComponent,variable:generatedIdentifier(ctx,'initialNodes').name,descriptors:[],
      ...(initialComponent.retainCreation?{adopting:initialRoot!}:{})};
  }
  for (const token of ctx.ownerListProvenance.get(name)?.values() ?? []) {
    scope.prelude.push(astFactory.variableDeclaration('const', [astFactory.variableDeclarator(
      astFactory.identifier(token), astFactory.callExpression(md(ctx, 'createListProvenance'), []),
    )]));
  }
  scope.cacheText = placement.listed;
  const localDerivations = ctx.instanceDerivations.get(name);
  const controlFlow = ctx.instanceControlFlow.get(name);
  const effects = ctx.effects.get(name);
  const reasonIds = ctx.instanceReasonIds.get(name);
  if (
    reasonIds !== undefined ||
    ctx.targetedListComponents.has(name) ||
    ctx.listComponents.has(name) ||
    hasLocalEffects
  ) {
    scope.reasonVar = generatedIdentifier(ctx, 'reasons').name;
  }
  if (reasonIds !== undefined && !lightweight) {
    scope.trackPullExpressions = component.pullPlan !== null;
    scope.slotReasons = (expression) => {
      const sources = expressionSources.sourcesFor(expression);
      if (sources === null) return null;
      const reasons: number[] = [];
      for (const source of sources) {
        const sourceReasons = instanceSourceReasons(ctx, name, source);
        if (sourceReasons === null) return null;
        reasons.push(...sourceReasons);
      }
      // A derivation rooted in a module list replays on the structural
      // string reason; the slot that renders it must open on it too.
      return [
        ...reasons.sort((left, right) => left - right),
        ...structuralReasonsFor(ctx, sources),
      ];
    };
  }
  const factoryId = generatedIdentifier(ctx, 'id').name;
  const routeContext = ownsRoutes ? generatedIdentifier(ctx, 'routeContext') : null;
  if (routeContext !== null) ctx.routeContextParams.set(name, routeContext.name);
  const factoryParent = lightweight
    ? null
    : generatedIdentifier(ctx, 'parent').name;
  const factoryOwner =
    lightweight && sourceLocal
      ? generatedIdentifier(ctx, 'owner').name
      : null;
  const factoryEventBindings = new Map<string, string>();
  if (lightweight) {
    for (const eventName of ctx.componentHostEvents.get(name) ?? []) {
      const binding = generatedIdentifier(ctx, `${eventName}Binding`).name;
      factoryEventBindings.set(eventName, binding);
      scope.delegatedEventBindings.set(eventName, binding);
    }
  }
  const propsBox =
    propSlotCount > 0 && !lightweight
      ? generatedIdentifier(ctx, 'props').name
      : null;
  requireIdentifiers(ctx).registerComponentId(name, factoryId);

  const rowCtx = buildComponentRowContext(
    placement.row,
    lightweight,
    scope.updateVar,
    factoryId,
    factoryOwner,
    factoryParent,
  );

  transformComponentLifecycle(ctx, path, name, factoryId, rowCtx);
  // Structural emitters may replace nodes inside the authored return subtree.
  // Snapshot the statements retained by the factory before emission so
  // removal does not depend on object identity after those replacements.
  const effectStatements = new Set<t.Statement>(
    effects?.map((site) => site.statement) ?? [],
  );
  const removedByPlan =
    'jsx' in returns
      ? (statement: t.Statement) => statement === returns.statement
      : (statement: t.Statement) => returns.statements.has(statement);
  const kept = node.body.body.filter(
    (statement) =>
      !removedByPlan(statement) && !effectStatements.has(statement),
  );
  const rootVar =
    'jsx' in returns
      ? emitNode(ctx, scope, returns.jsx, name, path, null, rowCtx)
      : emitComponentReturnRegion(
          ctx,
          scope,
          returns,
          name,
          path,
          factoryId,
        );
  const lightweightSingleRoot =
    lightweight && 'jsx' in returns && astFactory.isJSXElement(returns.jsx);
  if (scope.initialDom) scope.prelude.unshift(astFactory.variableDeclaration('const',[
    astFactory.variableDeclarator(astFactory.identifier(scope.initialDom.variable),
      scope.initialDom.adopting ? astFactory.conditionalExpression(scope.initialDom.adopting,
        astFactory.callExpression(md(ctx,'bindInitialNodes'),[
          initialRoot!,astFactory.arrayExpression(scope.initialDom.descriptors),
        ]),astFactory.arrayExpression([])) : astFactory.callExpression(md(ctx,'bindInitialNodes'),[
        initialRoot ?? astFactory.stringLiteral(scope.initialDom.plan.target),astFactory.arrayExpression(scope.initialDom.descriptors),
      ])),
  ]));

  const serverWriter = lightweightSingleRoot && !scope.initialDom
    ? prepareServerWriter(ctx, scope, rootVar)
    : null;

  if (lightweight) {
    applyRepeatedDomTemplate(ctx, scope, rootVar);
  }

  if (localDerivations !== undefined) {
    for (const derivation of localDerivations) {
      if (derivation.stableTarget !== true) {
        derivation.declaration.kind = 'let';
      }
    }
  }
  if (localDerivations !== undefined || controlFlow !== undefined) {
    scope.updaters.unshift(() =>
      buildRenderPreludeReplay(
        ctx,
        name,
        scope.reasonVar,
        node.body.body,
        localDerivations ?? [],
        controlFlow ?? [],
        scope.slotPullIndependent,
      ),
    );
  }
  if (effects !== undefined && hasLocalEffects) {
    scope.updaters.push(() =>
      buildLocalEffectInvalidations(
        ctx,
        name,
        factoryId,
        scope.reasonVar,
        effects,
        scope,
      ),
    );
  }
  if (propSlotCount > 0 && !lightweight) {
    scope.updaters.unshift(() =>
      astFactory.blockStatement(
        buildPropReplay(
          propPlan,
          propPlan.params.map((_, index) =>
            astFactory.memberExpression(
              astFactory.identifier(propsBox!),
              astFactory.numericLiteral(index),
              true,
            ),
          ),
        ),
      ),
    );
  }

  const eventSourceDisposals: t.Statement[] = [];
  const eventSources = ctx.eventSourceSlots.get(name);
  if (eventSources !== undefined) {
    for (const sourceName of eventSources) {
      const slotId = generatedIdentifier(ctx, `${sourceName}EventSourceSlot`).name;
      scope.prelude.push(
        astFactory.variableDeclaration('const', [
          astFactory.variableDeclarator(
            astFactory.identifier(slotId),
            astFactory.callExpression(mdd(ctx, 'createEventSourceSlot'), []),
          ),
        ]),
      );
      scope.updaters.unshift(() =>
        astFactory.expressionStatement(
          astFactory.callExpression(mdd(ctx, 'rebindEventSourceSlot'), [
            astFactory.identifier(slotId),
            astFactory.arrowFunctionExpression(
              [],
              astFactory.identifier(sourceName),
            ),
            astFactory.arrowFunctionExpression(
              [],
              astFactory.callExpression(md(ctx, 'invalidateEntity'), [
                astFactory.identifier(factoryId),
              ]),
            ),
          ]),
        ),
      );
      eventSourceDisposals.push(
        astFactory.expressionStatement(
          astFactory.callExpression(md(ctx, 'cleanup'), [
            astFactory.identifier(factoryId),
            astFactory.arrowFunctionExpression(
              [],
              astFactory.callExpression(mdd(ctx, 'disposeEventSourceSlot'), [
                astFactory.identifier(slotId),
              ]),
            ),
          ]),
        ),
      );
    }
  }

  const sourceMounts = transparentSourceMounts(
    ctx,
    name,
    astFactory.identifier(factoryId),
  );
  // Materialize the updater fn before markup rewrites creation so the
  // pass can see every late reference to member nodes and the document
  // local (dynamic writes inside updaters bind nodes too).
  if (scope.trackPullExpressions) {
    scope.slotPullIndependent = component.pullPlan!.finalize(
      execution => ctx.analyzedFunctions.has(execution as t.Node),
    ).independentFor;
  }
  const updateStatement = updateDecl(ctx, scope);
  const writerBranch = serverWriter?.(updateStatement, buildLightweightReturn(
    ctx, scope, propPlan, positionalObjectProps, lightweightPropCount, rootVar, true,
  ));
  applyStaticMarkup(ctx, scope, rootVar, [
    ...scope.mounts,
    ...sourceMounts,
    ...eventSourceDisposals,
    updateStatement,
  ]);

  const body: t.Statement[] = [cacheDecl(scope), ...scope.prelude];
  if (propSlotCount > 0 && !lightweight) {
    const declaration = buildPropDeclaration(
      propPlan,
      propPlan.params.map((_, index) =>
        astFactory.memberExpression(
          astFactory.identifier(propsBox!),
          astFactory.numericLiteral(index),
          true,
        ),
      ),
    );
    if (declaration !== null) body.push(declaration);
  }
  body.push(
    ...kept,
    ...(writerBranch == null ? [] : [writerBranch]),
    updateStatement,
    ...(lightweight
      ? []
      : [
          registerStmt(
            ctx,
            astFactory.identifier(factoryId),
            astFactory.identifier(factoryParent!),
            astFactory.identifier(scope.updateVar),
            ctx.volatileComponents.has(name),
          ),
        ]),
  );
  if (propSlotCount > 0 && !lightweight) {
    body.push(
      astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'registerProps'), [
          astFactory.identifier(factoryId),
          astFactory.identifier(propsBox!),
          ...(reasonIds === undefined
            ? []
            : propReasonArguments(propPlan, reasonIds) ?? []),
        ]),
      ),
    );
  }
  body.push(...scope.creation, ...scope.mounts);
  if (!lightweight) {
    for (const region of scope.disposableRegions) {
      body.push(astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'cleanup'), [
          astFactory.identifier(factoryId),
          astFactory.arrowFunctionExpression([], astFactory.callExpression(
            astFactory.memberExpression(astFactory.identifier(region), astFactory.identifier('dispose')),
            [],
          )),
        ]),
      ));
    }
  }
  body.push(...sourceMounts, ...eventSourceDisposals);
  for (const source of externalSources) {
    const subscribe = ctx.externalReactiveBindings.get(source)!;
    const selectors = routeSelectors.get(source);
    const subscriptions = selectors === undefined || selectors === null
      ? [astFactory.callExpression(astFactory.identifier(subscribe), [
          astFactory.identifier(source),
          astFactory.arrowFunctionExpression(
            [],
            astFactory.callExpression(md(ctx, 'invalidateEntity'), [
              astFactory.identifier(factoryId),
            ]),
          ),
        ])]
      : selectors.map(selector => {
          const selectedRoute = generatedIdentifier(ctx, 'selectedRoute');
          return astFactory.callExpression(astFactory.identifier(
            selectedRouteSubscriptionBinding(ctx),
          ), [
            astFactory.arrowFunctionExpression(
              [selectedRoute],
              routeSelectorExpression(selector, selectedRoute),
            ),
            astFactory.arrowFunctionExpression(
              [],
              astFactory.callExpression(md(ctx, 'invalidateEntity'), [
                astFactory.identifier(factoryId),
              ]),
            ),
          ]);
        });
    for (const subscription of subscriptions) {
      body.push(
        astFactory.expressionStatement(
          astFactory.callExpression(md(ctx, 'cleanup'), [
            astFactory.identifier(factoryId),
            subscription,
          ]),
        ),
      );
    }
  }
  if (effects !== undefined) {
    body.push(...buildEffectRegistrations(ctx, factoryId, effects));
  }
  if (ctx.hot && !lightweight) {
    body.push(
      astFactory.expressionStatement(
        astFactory.callExpression(mdHot(ctx, 'registerHotComponent'), [
          astFactory.identifier(name),
          astFactory.identifier(factoryId),
          astFactory.identifier(factoryParent!),
          astFactory.callExpression(md(ctx, 'rootNodes'), [astFactory.identifier(rootVar)]),
          propsBox === null ? astFactory.nullLiteral() : astFactory.identifier(propsBox),
        ]),
      ),
    );
  }
  body.push(
    lightweight
      ? buildLightweightReturn(
          ctx,
          scope,
          propPlan,
          positionalObjectProps,
          lightweightPropCount,
          rootVar,
          lightweightSingleRoot,
        )
      : astFactory.returnStatement(astFactory.identifier(rootVar)),
  );

  node.params = buildFactoryParameters(
    propPlan,
    positionalObjectProps,
    lightweight,
    propSlotCount,
    factoryId,
    factoryParent,
    factoryOwner,
    factoryEventBindings,
    propsBox,
    dataPolicies,
    routeContext,
  );
  if (initialRoot) node.params.push(initialRoot);
  node.body = astFactory.blockStatement(body);
}

function emitComponentReturnRegion(
  ctx: Ctx,
  scope: ReturnType<typeof newEmitScope>,
  plan: ComponentReturnPlan,
  name: string,
  path: ComponentPath,
  factoryId: string,
): string {
  const fragment = generatedIdentifier(ctx, 'returnRoot').name;
  const region = generatedIdentifier(ctx, 'returnRegion').name;
  const owner = astFactory.identifier(factoryId);
  const regionId = astFactory.binaryExpression(
    '+',
    cloneEstreeNode(owner),
    astFactory.stringLiteral('/$return'),
  );
  scope.creation.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        astFactory.identifier(fragment),
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
  scope.creation.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        astFactory.identifier(region),
        astFactory.callExpression(md(ctx, 'createCondRegion'), [
          astFactory.identifier(fragment),
          cloneEstreeNode(regionId),
          cloneEstreeNode(plan.pick),
          astFactory.arrayExpression(
            plan.branches.map((jsx) =>
              jsx !== null
                ? buildBranchCreate(
                    ctx,
                    jsx,
                    name,
                    path,
                    regionId,
                    false,
                    owner,
                    true,
                    scope.usedConds,
                    scope,
                  )
                : astFactory.nullLiteral(),
            ),
          ),
        ]),
      ),
    ]),
  );
  scope.updaters.push(() =>
    astFactory.expressionStatement(
      astFactory.callExpression(
        astFactory.memberExpression(
          astFactory.identifier(region),
          astFactory.identifier('update'),
        ),
        [],
      ),
    ),
  );
  return fragment;
}
