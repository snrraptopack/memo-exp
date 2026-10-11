/**
 * jsx/refs.ts - compile DOM ref values and mount them with structural cleanup.
 *
 * Assignable source expressions are sinks, not reads. They become ordinary
 * callback adapters so forwarding needs no public ref wrapper or special key.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { compileRefValue as compileSharedRefValue } from '../emission/refs';
import type { ComponentPath } from '../context';
import { type DomContext as Ctx } from './context';

import { generatedIdentifier, md } from './identifiers';
import type { EmitScope } from './scope';

/** Compile ref values through the shared target-neutral assignment contract. */
export function compileRefValue(
  ctx: Ctx,
  path: ComponentPath,
  name: string,
  expression: t.Expression,
): t.Expression {
  return compileSharedRefValue(ctx, path, name, expression, {
    fresh: (base) => generatedIdentifier(ctx, base),
    runtime: (base) => md(ctx, base),
  });
}
/** Emit one mount operation and attach its disposer to this scope's policy. */
export function emitRefMount(
  ctx: Ctx,
  scope: EmitScope,
  node: t.Expression,
  ownerId: t.Expression,
  value: t.Expression,
): void {
  const disposer = generatedIdentifier(ctx, 'refDispose');
  scope.mounts.push(
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        cloneEstreeNode(disposer),
        astFactory.callExpression(md(ctx, 'mountRef'), [
          cloneEstreeNode(node, true),
          cloneEstreeNode(value, true),
        ]),
      ),
    ]),
  );
  if (scope.manualDisposal) {
    scope.disposableCallbacks.push(disposer);
  } else {
    scope.mounts.push(
      astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'cleanup'), [
          cloneEstreeNode(ownerId, true),
          cloneEstreeNode(disposer),
        ]),
      ),
    );
  }
}
