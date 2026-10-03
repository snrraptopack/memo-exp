/** Target-independent callback syntax and row derivation normalization. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode, extractPatternIdentifiers, type BaseNode } from '../ast';
import { cloneRuntimeBindingPattern } from '../analysis/runtime-pattern';
import type { MapCallExpression } from '../context/model';
import { assertNoShadowing, assertRowRenderExpression, collectRowDerivations, substituteRowDerivations } from './row-derivations';

type Fail = (message: string, at?: t.Node) => never;
type RuntimeBindingPattern = t.Identifier | t.ObjectPattern | t.ArrayPattern;

export interface ListCallbackPlan {
  readonly prelude: readonly t.ExpressionStatement[];
  readonly itemPattern: RuntimeBindingPattern;
  readonly itemParam: string;
  readonly indexParam: string | null;
  readonly jsx: t.JSXElement | null;
  /** Normalized source replacement applied by the shared analysis adapter. */
  readonly normalizedBody: t.JSXElement | null;
}

export function planListCallback(
  call: MapCallExpression,
  fail: Fail,
): ListCallbackPlan {
  if (
    call.arguments.length !== 1 ||
    !astFactory.isArrowFunctionExpression(call.arguments[0])
  ) {
    return fail(
      'memo-dom: list rendering expects items.map(item => <JSX />) — R7 L1',
    );
  }
  const callback = call.arguments[0];
  const first = callback.params[0];
  const second = callback.params[1];
  if (
    callback.params.length < 1 ||
    callback.params.length > 2 ||
    (!astFactory.isIdentifier(first) &&
      !astFactory.isObjectPattern(first) &&
      !astFactory.isArrayPattern(first)) ||
    (second !== undefined && !astFactory.isIdentifier(second))
  ) {
    return fail(
      'memo-dom: list callback must take an item binding pattern and optional index identifier — R7 L1',
    );
  }

  const itemPattern = cloneRuntimeBindingPattern(first);
  const itemBindings = extractPatternIdentifiers(
    itemPattern as unknown as BaseNode,
  ).map((identifier) => identifier.name);
  if (itemBindings.length === 0) {
    return fail(
      'memo-dom: list callback item pattern must bind at least one name — R7 L1',
    );
  }
  const itemParam = astFactory.isIdentifier(itemPattern)
    ? itemPattern.name
    : itemBindings[0]!;
  const indexParam = astFactory.isIdentifier(second) ? second.name : null;
  const prelude: t.ExpressionStatement[] = [];
  const jsx = resolveCallbackJsx(callback, itemPattern, indexParam, fail, prelude);
  return {
    prelude,
    itemPattern,
    itemParam,
    indexParam,
    jsx,
    normalizedBody: astFactory.isBlockStatement(callback.body) &&
      callback.body.body.length > 1 && prelude.length === 0 ? jsx : null,
  };
}

/**
 * Normalize supported callback body shapes to a bare JSX element.
 *
 * A block body of `const` derivations followed by `return <JSX />` is
 * beta-reduced: each derivation initializer is substituted for every
 * reference in the returned JSX (and in later initializers). Reads stay
 * visible to read collection and guarded slots re-evaluate per update, so
 * invalidation and freshness are unchanged; initializers must therefore be
 * pure.
 */
function resolveCallbackJsx(
  callback: t.ArrowFunctionExpression,
  itemPattern: RuntimeBindingPattern,
  indexParam: string | null,
  fail: Fail,
  prelude: t.ExpressionStatement[],
): t.JSXElement | null {
  if (astFactory.isJSXElement(callback.body)) return callback.body;
  if (!astFactory.isBlockStatement(callback.body)) return null;
  const statements = callback.body.body;
  const tail = statements.at(-1);
  if (
    tail === undefined ||
    !astFactory.isReturnStatement(tail) ||
    !astFactory.isJSXElement(tail.argument)
  ) {
    return null;
  }
  const jsx = tail.argument;
  if (statements.length > 1) {
    const reserved = new Set([
      ...extractPatternIdentifiers(itemPattern as unknown as BaseNode).map(
        (identifier) => identifier.name,
      ),
      ...(indexParam === null ? [] : [indexParam]),
    ]);
    const resolved = new Map<string, t.Expression>();
    for (const statement of statements.slice(0, -1)) {
      if (astFactory.isExpressionStatement(statement)) {
        // Apply the existing render-expression restrictions without choosing
        // call behavior by method name. Keep each authored call exactly once.
        assertRowRenderExpression(statement.expression, fail);
        assertNoShadowing(statement, new Set(resolved.keys()), fail);
        prelude.push(substituteRowDerivations(cloneEstreeNode(statement), resolved));
        continue;
      }
      for (const derivation of collectRowDerivations([statement], reserved, fail)) {
        resolved.set(derivation.name, substituteRowDerivations(derivation.init, resolved));
      }
    }
    assertNoShadowing(jsx, new Set(resolved.keys()), fail);
    const substituted = substituteRowDerivations(jsx, resolved);
    // Expression-bearing blocks remain in the source tree; only the adapter
    // applies the returned replacement for const-only blocks.
    return substituted;
  }
  return jsx;
}
