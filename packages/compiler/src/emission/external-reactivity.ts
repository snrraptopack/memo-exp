/** Shared import allocation for existing library subscription contracts. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { canonicalStateKey, type Ctx } from '../context';

export interface SubscriptionImport {
  module: string;
  imported: string;
  local: string;
}

export function allocateSubscriptionImport(
  imports: Map<string, SubscriptionImport>,
  contract: { readonly module: string; readonly export: string },
  fresh: (name: string) => t.Identifier,
): string {
  const key = `${contract.module}\0${contract.export}`;
  let adapter = imports.get(key);
  if (!adapter) {
    adapter = {
      module: contract.module,
      imported: contract.export,
      local: fresh('subscribeExternal').name,
    };
    imports.set(key, adapter);
  }
  return adapter.local;
}

export function subscriptionImports(
  imports: ReadonlyMap<string, SubscriptionImport>,
): t.ImportDeclaration[] {
  return [...imports.values()].map((adapter) =>
    b.importDeclaration(
      [b.importSpecifier(b.identifier(adapter.local), b.identifier(adapter.imported))],
      b.stringLiteral(adapter.module),
    ),
  );
}

export interface SubscriptionEmission {
  fresh(name: string): t.Identifier;
  runtime(name: string): t.Expression;
  adapter(source: string): string;
  guard?: t.Expression;
  afterChange?: readonly t.Statement[];
}

/** Capture core ownership once; foreign callbacks do not inherit application scope. */
export function emitOwnedSourceSubscriptions(
  ctx: Ctx,
  sources: readonly string[],
  parent: t.Expression,
  emitter: SubscriptionEmission,
): t.Statement[] {
  if (sources.length === 0) return [];
  const application = emitter.fresh('__subscriptionApplication');
  const statements: t.Statement[] = [
    b.variableDeclaration('const', [
      b.variableDeclarator(
        application,
        b.callExpression(emitter.runtime('getActiveApplicationRuntime'), []),
      ),
    ]),
  ];

  for (const source of sources) {
    const active = emitter.fresh('__subscriptionActive');
    const dispose = emitter.fresh('__subscriptionDispose');
    const guard = emitter.guard ? b.logicalExpression('&&', active, emitter.guard) : active;
    const listener = b.arrowFunctionExpression(
      [],
      b.blockStatement([
        b.ifStatement(
          guard,
          b.expressionStatement(
            b.callExpression(emitter.runtime('runInApplicationRuntime'), [
              application,
              b.arrowFunctionExpression(
                [],
                b.blockStatement([
                  b.expressionStatement(
                    b.callExpression(emitter.runtime('commitWrites'), [
                      b.arrayExpression([b.stringLiteral(canonicalStateKey(ctx, source))]),
                    ]),
                  ),
                  ...(emitter.afterChange ?? []),
                ]),
              ),
            ]),
          ),
        ),
      ]),
    );
    statements.push(
      b.variableDeclaration('let', [b.variableDeclarator(active, b.booleanLiteral(true))]),
      b.variableDeclaration('const', [
        b.variableDeclarator(
          dispose,
          b.callExpression(b.identifier(emitter.adapter(source)), [b.identifier(source), listener]),
        ),
      ]),
      b.expressionStatement(
        b.callExpression(emitter.runtime('cleanup'), [
          parent,
          b.arrowFunctionExpression(
            [],
            b.blockStatement([
              // Disable first: an unsubscribe implementation may synchronously notify.
              b.expressionStatement(b.assignmentExpression('=', active, b.booleanLiteral(false))),
              b.expressionStatement(b.callExpression(dispose, [])),
            ]),
          ),
        ]),
      ),
    );
  }
  return statements;
}
