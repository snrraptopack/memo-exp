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
  type RowCtx,
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
  const scope = newEmitScope(ctx, lightweight);
  const localDerivations = ctx.instanceDerivations.get(name);
  const controlFlow = ctx.instanceControlFlow.get(name);
  const effects = ctx.effects.get(name);
  const hasLocalEffects =
    effects?.some(
      (site) =>
        site.localReads.size > 0 ||
        site.localDerivationReads.size > 0 ||
        site.conditionLocalReads.size > 0 ||
        site.conditionLocalDerivationReads.size > 0,
    ) === true;
  if (
    ctx.selectiveDerivationComponents.has(name) ||
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
  const propsBox =
    propSlotCount > 0 && !lightweight
      ? generatedIdentifier(ctx, 'props').name
      : null;
  requireIdentifiers(ctx).registerComponentId(name, factoryId);

  let rowCtx: RowCtx | undefined;
  if (
    (refs.length > 0 || linkedRefs.length > 0) &&
    propPlan.bindings.length > 0
  ) {
    const keyPaths = [
      ...refs.map((ref) =>
        keyPathOf(ref.keyExpr ?? null, ref.itemParam ?? ''),
      ),
      ...linkedRefs.map((ref) => ref.keyPath),
    ];
    const first = JSON.stringify(keyPaths[0]);
    const merged = keyPaths.every(
      (keyPath) => JSON.stringify(keyPath) === first,
    )
      ? keyPaths[0]!
      : null;
    const directItem = localBindingForProp(propPlan, 'item');
    const propsObject = objectBindingName(propPlan);
    rowCtx = {
      itemParam: directItem ?? propsObject ?? propPlan.bindings[0]!,
      itemPath: directItem === null && propsObject !== null ? ['item'] : [],
      rowIdVar: factoryId,
      ...(lightweight ? { refreshVar: scope.updateVar } : {}),
      keyPath: merged,
      sourceKey:
        refs[0]?.sourceKey ?? linkedRefs[0]?.sourceKey ?? '',
      sourceLocal,
      ...(sourceLocal
        ? { ownerIdVar: factoryOwner ?? factoryParent! }
        : {}),
    };
  }

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
  if (lightweight) {
    const nextProps = propPlan.params.map((_, index) =>
      generatedIdentifier(ctx, `nextProp${index}`),
    );
    body.push(
      t.returnStatement(
        t.objectExpression([
          t.objectProperty(
            t.identifier('nodes'),
            t.callExpression(md(ctx, 'rootNodes'), [
              t.identifier(rootVar),
            ]),
          ),
          t.objectProperty(
            t.identifier('entities'),
            t.arrayExpression([]),
          ),
          t.objectProperty(
            t.identifier('update'),
            t.identifier(scope.updateVar),
          ),
          ...(propSlotCount > 0
            ? [
                t.objectProperty(
                  t.identifier('updateProps'),
                  t.arrowFunctionExpression(
                    nextProps,
                    t.blockStatement(
                      buildPropReplay(propPlan, nextProps),
                    ),
                  ),
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
      ),
    );
  } else {
    body.push(t.returnStatement(t.identifier(rootVar)));
  }

  node.params = lightweight
    ? [
        ...propPlan.params.map(runtimeParameter),
        t.identifier(factoryId),
        ...(factoryOwner === null ? [] : [t.identifier(factoryOwner)]),
      ]
    : propSlotCount > 0
      ? [
          t.identifier(factoryId),
          t.identifier(factoryParent!),
          t.identifier(propsBox!),
        ]
      : [t.identifier(factoryId), t.identifier(factoryParent!)];
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
