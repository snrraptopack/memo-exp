/**
 * emission/component.ts - component source functions to runtime factories.
 *
 * This emitter owns the component factory ABI, prop and local-derivation
 * replay order, lifecycle registration, and listed-row identity. DOM and
 * structural-region creation remain in emit.ts.
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
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
  updateDecl,
} from './scope';
import { applyRepeatedDomTemplate } from './dom-template';

type ComponentEmitScope = ReturnType<typeof newEmitScope>;

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
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.identifier(local),
            t.cloneNode(nextProps[index]!),
          ),
        ),
      );
  return t.returnStatement(
    t.objectExpression([
      t.objectProperty(
        t.identifier('nodes'),
        singleRoot
          ? t.identifier(rootVar)
          : t.callExpression(md(ctx, 'rootNodes'), [t.identifier(rootVar)]),
      ),
      t.objectProperty(t.identifier('entities'), t.arrayExpression([])),
      t.objectProperty(t.identifier('update'), t.identifier(scope.updateVar)),
      ...(lightweightPropCount > 0
        ? [
            t.objectProperty(
              t.identifier('updateProps'),
              t.arrowFunctionExpression(nextProps, t.blockStatement(replay)),
            ),
          ]
        : []),
      ...(scope.disposableCallbacks.length > 0
        ? [
            t.objectProperty(
              t.identifier('dispose'),
              t.arrowFunctionExpression(
                [],
                t.blockStatement(
                  [...scope.disposableCallbacks]
                    .reverse()
                    .map((callback) =>
                      t.ifStatement(
                        t.binaryExpression(
                          '!==',
                          t.cloneNode(callback),
                          t.nullLiteral(),
                        ),
                        t.expressionStatement(
                          t.callExpression(t.cloneNode(callback), []),
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
): t.FunctionDeclaration['params'] {
  if (lightweight) {
    return [
      ...(positionalObjectProps === null
        ? propPlan.params.map(runtimeParameter)
        : positionalObjectProps.map(({ local }) => t.identifier(local))),
      t.identifier(factoryId),
      ...(factoryOwner === null ? [] : [t.identifier(factoryOwner)]),
      ...[...eventBindings.values()].map((binding) => t.identifier(binding)),
    ];
  }
  return propSlotCount > 0
    ? [
        t.identifier(factoryId),
        t.identifier(factoryParent!),
        t.identifier(propsBox!),
      ]
    : [t.identifier(factoryId), t.identifier(factoryParent!)];
}

export function transformComponent(
  ctx: Ctx,
  path: NodePath<t.FunctionDeclaration>,
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
  const lightweight = isLightweightListedComponent(ctx, name);
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
    lightweight && 'jsx' in returns && t.isJSXElement(returns.jsx);

  if (lightweight) {
    applyRepeatedDomTemplate(ctx, scope, rootVar);
  }

  if (localDerivations !== undefined) {
    for (const derivation of localDerivations) {
      derivation.declaration.kind = 'let';
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

  if (propSlotCount > 0 && !lightweight) {
    scope.updaters.unshift(() =>
      t.blockStatement(
        buildPropReplay(
          propPlan,
          propPlan.params.map((_, index) =>
            t.memberExpression(
              t.identifier(propsBox!),
              t.numericLiteral(index),
              true,
            ),
          ),
        ),
      ),
    );
  }

  const body: t.Statement[] = [cacheDecl(scope)];
  if (propSlotCount > 0 && !lightweight) {
    const declaration = buildPropDeclaration(
      propPlan,
      propPlan.params.map((_, index) =>
        t.memberExpression(
          t.identifier(propsBox!),
          t.numericLiteral(index),
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
            t.identifier(factoryId),
            t.identifier(factoryParent!),
            t.identifier(scope.updateVar),
            ctx.volatileComponents.has(name),
          ),
        ]),
  );
  if (propSlotCount > 0 && !lightweight) {
    body.push(
      t.expressionStatement(
        t.callExpression(md(ctx, 'registerProps'), [
          t.identifier(factoryId),
          t.identifier(propsBox!),
        ]),
      ),
    );
  }
  body.push(...scope.creation, ...scope.mounts);
  if (effects !== undefined) {
    body.push(...buildEffectRegistrations(ctx, factoryId, effects));
  }
  if (ctx.hot && !lightweight) {
    body.push(
      t.expressionStatement(
        t.callExpression(md(ctx, 'registerHotComponent'), [
          t.identifier(name),
          t.identifier(factoryId),
          t.identifier(factoryParent!),
          t.callExpression(md(ctx, 'rootNodes'), [t.identifier(rootVar)]),
          propsBox === null ? t.nullLiteral() : t.identifier(propsBox),
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
      : t.returnStatement(t.identifier(rootVar)),
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
  );
  node.body = t.blockStatement(body);
}

function emitComponentReturnRegion(
  ctx: Ctx,
  scope: ReturnType<typeof newEmitScope>,
  plan: ComponentReturnPlan,
  name: string,
  path: NodePath<t.FunctionDeclaration>,
  factoryId: string,
): string {
  const fragment = generatedIdentifier(ctx, 'returnRoot').name;
  const region = generatedIdentifier(ctx, 'returnRegion').name;
  const owner = t.identifier(factoryId);
  const regionId = t.binaryExpression(
    '+',
    t.cloneNode(owner),
    t.stringLiteral('/$return'),
  );
  scope.creation.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(fragment),
        t.callExpression(
          t.memberExpression(
            t.identifier('document'),
            t.identifier('createDocumentFragment'),
          ),
          [],
        ),
      ),
    ]),
  );
  scope.creation.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(region),
        t.callExpression(md(ctx, 'createCondRegion'), [
          t.identifier(fragment),
          t.cloneNode(regionId),
          t.cloneNode(plan.pick),
          t.arrayExpression(
            plan.branches.map((jsx) =>
              buildBranchCreate(
                ctx,
                jsx,
                name,
                path,
                regionId,
                false,
                owner,
                true,
                scope.usedConds,
              ),
            ),
          ),
        ]),
      ),
    ]),
  );
  scope.updaters.push(() =>
    t.expressionStatement(
      t.callExpression(
        t.memberExpression(
          t.identifier(region),
          t.identifier('update'),
        ),
        [],
      ),
    ),
  );
  return fragment;
}
