/**
 * emission/component.ts - component source functions to runtime factories.
 *
 * This emitter owns the component factory ABI, prop and local-derivation
 * replay order, lifecycle registration, and listed-row identity. DOM and
 * structural-region creation remain in emit.ts.
 */

import type * as t from '@babel/types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { isLightweightListedComponent } from '../analysis';
import {
  keyPathOf,
  type Ctx,
  type EffectSite,
  type LinkedComponentRowUse,
  type RowCtx,
  type SiteRef,
} from '../context';
import { buildBranchCreate, emitNode } from '../emit';
import {
  generatedIdentifier,
  md,
  requireIdentifiers,
} from '../identifiers';
import { transformComponentLifecycle } from '../lifecycle';
import {
  buildPropDeclaration,
  buildPropReplay,
  localBindingForProp,
  objectBindingName,
  runtimeParameter,
  simpleObjectPropBindings,
  type ComponentPropsPlan,
  type SimpleObjectPropBinding,
} from '../components/props';
import { buildRenderPreludeReplay } from '../components/render-prelude';
import {
  analyzeComponentReturns,
  type ComponentReturnPlan,
} from '../components/return-plan';
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
import { transparentSourceMounts } from '../data-sources';

type ComponentEmitScope = ReturnType<typeof newEmitScope>;
type ComponentPath = Ctx['compPaths'] extends Map<string, infer TPath>
  ? TPath
  : never;

function hasComponentLocalEffects(effects: readonly EffectSite[] | undefined): boolean {
  return effects?.some(
    (site) =>
      site.localReads.size > 0 ||
      site.localDerivationReads.size > 0 ||
      site.conditionLocalReads.size > 0 ||
      site.conditionLocalDerivationReads.size > 0,
  ) === true;
}

function buildComponentRowContext(
  propPlan: ComponentPropsPlan,
  refs: readonly SiteRef[],
  linkedRefs: readonly LinkedComponentRowUse[],
  sourceLocal: boolean,
  lightweight: boolean,
  updateVar: string,
  factoryId: string,
  factoryOwner: string | null,
  factoryParent: string | null,
): RowCtx | undefined {
  if (
    (refs.length === 0 && linkedRefs.length === 0) ||
    propPlan.bindings.length === 0
  ) {
    return undefined;
  }
  const keyPaths = [
    ...refs.map((ref) => keyPathOf(ref.keyExpr ?? null, ref.itemParam ?? '')),
    ...linkedRefs.map((ref) => ref.keyPath),
  ];
  const first = JSON.stringify(keyPaths[0]);
  const keyPath = keyPaths.every(
    (candidate) => JSON.stringify(candidate) === first,
  )
    ? keyPaths[0]!
    : null;
  const directItem = localBindingForProp(propPlan, 'item');
  const propsObject = objectBindingName(propPlan);
  return {
    itemParam: directItem ?? propsObject ?? propPlan.bindings[0]!,
    itemPath: directItem === null && propsObject !== null ? ['item'] : [],
    rowIdVar: factoryId,
    ...(lightweight ? { refreshVar: updateVar } : {}),
    keyPath,
    sourceKey: refs[0]?.sourceKey ?? linkedRefs[0]?.sourceKey ?? '',
    sourceLocal,
    ...(sourceLocal
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
      ]
    : [
        astFactory.identifier(factoryId),
        astFactory.identifier(factoryParent!),
        ...(dataPolicies === null ? [] : [cloneEstreeNode(dataPolicies)]),
      ];
}

export function transformComponent(
  ctx: Ctx,
  path: ComponentPath,
  name: string,
): void {
  const node = path.node;
  const returns = analyzeComponentReturns(path, name);
  const propPlan = ctx.componentProps.get(name)!;
  const propSlotCount = propPlan.params.length;
  const refs = ctx.listedSites.get(name) ?? [];
  const linkedRefs = ctx.linkedComponentRows.get(name) ?? [];
  const sourceLocal =
    refs.some((ref) => ref.sourceLocal === true) ||
    linkedRefs.some((ref) => ref.sourceLocal);
  const dataPolicies = ctx.transparentPolicyParams.get(name) ?? null;
  const lightweight =
    dataPolicies === null &&
    !ctx.transparentSources.has(name) &&
    isLightweightListedComponent(ctx, name);
  const positionalObjectProps =
    lightweight && linkedRefs.length === 0
      ? simpleObjectPropBindings(propPlan)
      : null;
  const lightweightPropCount =
    positionalObjectProps?.length ?? propSlotCount;
  const scope = newEmitScope(ctx, lightweight);
  const localDerivations = ctx.instanceDerivations.get(name);
  const controlFlow = ctx.instanceControlFlow.get(name);
  const effects = ctx.effects.get(name);
  const hasLocalEffects = hasComponentLocalEffects(effects);
  if (
    ctx.selectiveDerivationComponents.has(name) ||
    ctx.targetedListComponents.has(name) ||
    hasLocalEffects
  ) {
    scope.reasonVar = generatedIdentifier(ctx, 'reasons').name;
  }
  const factoryId = generatedIdentifier(ctx, 'id').name;
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
    propPlan,
    refs,
    linkedRefs,
    sourceLocal,
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
  const kept = node.body.body.filter(
    (statement) =>
      !(
        'jsx' in returns
          ? statement === returns.statement
          : returns.statements.has(statement)
      ) && !effectStatements.has(statement),
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
    updateDecl(scope),
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
        ]),
      ),
    );
  }
  body.push(...scope.creation, ...scope.mounts);
  body.push(
    ...transparentSourceMounts(ctx, name, astFactory.identifier(factoryId)),
  );
  if (effects !== undefined) {
    body.push(...buildEffectRegistrations(ctx, factoryId, effects));
  }
  if (ctx.hot && !lightweight) {
    body.push(
      astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'registerHotComponent'), [
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
  );
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
