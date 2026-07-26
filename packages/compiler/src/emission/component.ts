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
import { emitNode } from '../emit';
import {
  generatedIdentifier,
  md,
  requireIdentifiers,
} from '../identifiers';
import { transformComponentLifecycle } from '../lifecycle';
import {
  buildDerivationReplay,
  buildPropDeclaration,
  buildPropReplay,
  localBindingForProp,
  objectBindingName,
  runtimeParameter,
} from '../components/props';
import {
  cacheDecl,
  newEmitScope,
  registerStmt,
  updateDecl,
} from './scope';
import type { JsxNode } from '../jsx/children';

export function transformComponent(
  ctx: Ctx,
  path: NodePath<t.FunctionDeclaration>,
  name: string,
): void {
  const node = path.node;
  const returns: NodePath<t.ReturnStatement>[] = [];
  path.get('body').traverse({
    ReturnStatement(returnPath) {
      returns.push(returnPath);
    },
    Function(functionPath) {
      functionPath.skip();
    },
  });
  const topLevel = returns.filter(
    (returnPath) => returnPath.getFunctionParent() === path,
  );
  const jsxTop = topLevel.filter(
    (returnPath) =>
      t.isJSXElement(returnPath.node.argument) ||
      t.isJSXFragment(returnPath.node.argument),
  );
  if (jsxTop.length !== 1 || topLevel.length !== 1) {
    throw path.buildCodeFrameError(
      `memo-dom: component '${name}' must have exactly one top-level JSX return (L1)`,
    );
  }
  const returnStmt = jsxTop[0]!.node;
  const jsx = returnStmt.argument as JsxNode;
  const propPlan = ctx.componentProps.get(name)!;
  const propSlotCount = propPlan.params.length;
  const refs = ctx.listedSites.get(name) ?? [];
  const linkedRefs = ctx.linkedComponentRows.get(name) ?? [];
  const sourceLocal =
    refs.some((ref) => ref.sourceLocal === true) ||
    linkedRefs.some((ref) => ref.sourceLocal);
  const lightweight = isLightweightListedComponent(ctx, name);
  const scope = newEmitScope(ctx);
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
    rowCtx = {
      itemParam:
        localBindingForProp(propPlan, 'item') ??
        objectBindingName(propPlan) ??
        propPlan.bindings[0]!,
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
  const rootVar = emitNode(ctx, scope, jsx, name, path, null, rowCtx);

  const localDerivations = ctx.instanceDerivations.get(name);
  if (localDerivations !== undefined) {
    for (const derivation of localDerivations) {
      derivation.declaration.kind = 'let';
    }
    scope.updaters.unshift(() =>
      t.blockStatement(
        localDerivations.map((derivation) =>
          buildDerivationReplay(derivation),
        ),
      ),
    );
  }
  const kept = node.body.body.filter((statement) => statement !== returnStmt);

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
  body.push(...scope.creation);
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
