/** Lower lifecycle ownership while keeping discovery in the shared compiler. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { walkAst } from '../ast/walk';
import { cloneNode } from '../ast';
import type { Ctx, ComponentPath, EffectSite, ModuleEffectSite } from '../context';
import { isIntrinsicLifecycleCall } from '../intrinsics';
import { valueExpression } from './lower-scene';

interface LifecycleEmission {
  fresh(name: string): t.Identifier;
  runtime(name: string): t.Expression;
  instrument(callback: t.Expression): void;
  owner?: t.Identifier;
}

/** Shared effect plans supply conditions, subscriptions and stable identities. */
export function desktopEffectRegistration(
  site: EffectSite | ModuleEffectSite,
  parent: t.Expression,
  id: t.Expression,
  emitter: LifecycleEmission,
): t.Statement {
  emitter.instrument(site.callback);
  return b.expressionStatement(
    b.callExpression(
      emitter.runtime(site.condition === null ? 'registerEffect' : 'registerConditionalEffect'),
      [
        id,
        parent,
        ...(site.condition === null
          ? []
          : [b.arrowFunctionExpression([], cloneNode(site.condition, true))]),
        cloneNode(site.callback, true),
      ],
    ),
  );
}

/** Capture cleanup values at their authored execution point, before mount. */
export function desktopLifecycle(
  ctx: Ctx,
  component: string,
  path: ComponentPath,
  emitter: LifecycleEmission & { owner: t.Identifier },
): { setup: t.Statement[]; properties: t.ObjectProperty[]; statements: Set<t.Statement> } {
  const sites = ctx.effects.get(component) ?? [];
  const statements = new Set(sites.map((site) => site.statement));
  const properties: t.ObjectProperty[] = [];
  const setup: t.Statement[] = [];
  const owner = emitter.fresh('__desktopLifecycleOwner');
  const disposers = emitter.fresh('__desktopCleanups');
  const capture = emitter.fresh('__desktopCleanup');
  const disposer = emitter.fresh('__desktopDisposer');
  let cleanupUsed = false;
  const captureCleanups = (root: t.Node): void => {
    walkAst<t.Node>(root, {
      enter(node) {
        if (!b.isCallExpression(node) || !isIntrinsicLifecycleCall(ctx, node, 'cleanup')) return;
        if (node.arguments.length !== 1 || !b.isExpression(node.arguments[0])) {
          throw path.buildCodeFrameError(
            'memo-dom: $cleanup() requires exactly one disposer',
            node,
          );
        }
        node.callee = capture;
        cleanupUsed = true;
      },
    });
  };
  captureCleanups(path.node.body);
  for (const site of sites) captureCleanups(site.callback);
  const parent = b.memberExpression(owner, b.identifier('entityId'));
  const identity = (index: number) =>
    b.binaryExpression('+', parent, b.stringLiteral(`/$effects/${index}`));
  if (sites.length) {
    properties.push(
      b.objectProperty(
        b.identifier('activate'),
        b.arrowFunctionExpression(
          [owner],
          b.blockStatement(
            sites.map((site) =>
              desktopEffectRegistration(site, parent, identity(site.index), emitter),
            ),
          ),
        ),
      ),
    );
    const bindings: t.Expression[] = [];
    for (const site of sites) {
      // Direct local sources select the effect. Derived values are compared
      // after setup replay so equal derivations do not restart their effects.
      const binding = (reads: Set<string>, derivations: Set<string>, active: boolean) => {
        if (!reads.size && !derivations.size) return;
        const derivedRoots = new Set<string>();
        for (const derivation of [
          ...(ctx.instanceDerivations.get(component) ?? []),
          ...(ctx.instanceControlFlow.get(component) ?? []),
        ]) {
          if (derivation.bindings.some((name) => derivations.has(name))) {
            for (const source of derivation.sources) derivedRoots.add(source);
          }
        }
        // Shared discovery expands derived reads to their source roots. Keep
        // those roots for replay, but let the resulting value govern effects.
        // A raw read of the same root already removes its derived-value guard
        // in the shared planner and therefore remains in this direct set.
        const directReads = [...reads].filter((source) => !derivedRoots.has(source));
        bindings.push(
          b.objectExpression([
            b.objectProperty(b.identifier('index'), b.numericLiteral(site.index)),
            b.objectProperty(b.identifier('active'), b.booleanLiteral(active)),
            b.objectProperty(b.identifier('sources'), valueExpression(directReads)),
            b.objectProperty(
              b.identifier('read'),
              b.arrowFunctionExpression([], b.arrayExpression([...derivations].map(b.identifier))),
            ),
          ]),
        );
      };
      if (site.condition !== null)
        binding(site.conditionLocalReads, site.conditionLocalDerivationReads, false);
      binding(site.localReads, site.localDerivationReads, site.condition !== null);
    }
    if (bindings.length)
      properties.push(b.objectProperty(b.identifier('effects'), b.arrayExpression(bindings)));
  }
  if (cleanupUsed) {
    setup.push(
      b.variableDeclaration('const', [b.variableDeclarator(disposers, b.arrayExpression([]))]),
      b.variableDeclaration('const', [
        b.variableDeclarator(
          capture,
          b.arrowFunctionExpression(
            [disposer],
            b.blockStatement([
              b.ifStatement(
                emitter.owner,
                b.expressionStatement(
                  b.callExpression(emitter.runtime('cleanup'), [
                    b.memberExpression(emitter.owner, b.identifier('entityId')),
                    disposer,
                  ]),
                ),
                b.expressionStatement(
                  b.callExpression(b.memberExpression(disposers, b.identifier('push')), [disposer]),
                ),
              ),
              b.returnStatement(disposer),
            ]),
          ),
        ),
      ]),
    );
    properties.push(b.objectProperty(b.identifier('cleanups'), disposers));
  }
  return { setup, properties, statements };
}
