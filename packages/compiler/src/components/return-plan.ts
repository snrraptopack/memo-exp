/**
 * Normalize supported JSX return control flow into one stable branch picker.
 */
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { JsxNode } from '../jsx/children';

export interface ComponentReturnPlan {
  /** Branch picker passed directly to createCondRegion(). */
  pick: t.ArrowFunctionExpression;
  branches: JsxNode[];
  /** Top-level source statements replaced by the structural region. */
  statements: Set<t.Statement>;
}

export interface DirectComponentReturn {
  jsx: JsxNode;
  statement: t.ReturnStatement;
}

export type ComponentReturns = DirectComponentReturn | ComponentReturnPlan;

function jsxReturn(statement: t.Statement): DirectComponentReturn | null {
  if (
    !t.isReturnStatement(statement) ||
    (!t.isJSXElement(statement.argument) &&
      !t.isJSXFragment(statement.argument))
  ) {
    return null;
  }
  return {
    jsx: statement.argument,
    statement,
  };
}

function soleJsxReturn(statement: t.Statement): DirectComponentReturn | null {
  if (t.isBlockStatement(statement)) {
    return statement.body.length === 1 ? jsxReturn(statement.body[0]!) : null;
  }
  return jsxReturn(statement);
}

function componentReturns(
  path: NodePath<t.FunctionDeclaration>,
): t.ReturnStatement[] {
  const returns: t.ReturnStatement[] = [];
  path.get('body').traverse({
    ReturnStatement(returnPath) {
      returns.push(returnPath.node);
    },
    Function(functionPath) {
      functionPath.skip();
    },
  });
  return returns;
}

function canHoistPastEarlyReturn(statement: t.Statement): boolean {
  if (t.isFunctionDeclaration(statement)) return true;
  if (t.isVariableDeclaration(statement)) {
    return statement.declarations.every(
      (declaration) =>
        declaration.init == null ||
        t.isFunction(declaration.init) ||
        expressionCanHoist(declaration.init),
    );
  }
  if (t.isSwitchStatement(statement) || t.isIfStatement(statement)) {
    let safe = true;
    t.traverseFast(statement, (node) => {
      if (
        t.isCallExpression(node) ||
        t.isOptionalCallExpression(node) ||
        t.isNewExpression(node) ||
        t.isAwaitExpression(node) ||
        t.isYieldExpression(node) ||
        t.isThrowStatement(node) ||
        t.isTaggedTemplateExpression(node) ||
        t.isUpdateExpression(node)
      ) {
        safe = false;
      }
    });
    return safe;
  }
  return t.isTypeScript(statement);
}

function expressionCanHoist(expression: t.Expression): boolean {
  let safe = true;
  t.traverseFast(expression, (node) => {
    if (
      t.isCallExpression(node) ||
      t.isOptionalCallExpression(node) ||
      t.isNewExpression(node) ||
      t.isAwaitExpression(node) ||
      t.isYieldExpression(node) ||
      t.isTaggedTemplateExpression(node) ||
      t.isAssignmentExpression(node) ||
      t.isUpdateExpression(node)
    ) {
      safe = false;
    }
  });
  return safe;
}

function switchPlan(statement: t.SwitchStatement): ComponentReturnPlan | null {
  if (!statement.cases.some((item) => item.test == null)) return null;
  const branches: JsxNode[] = [];
  const cases: t.SwitchCase[] = [];
  for (const item of statement.cases) {
    if (item.consequent.length !== 1) return null;
    const returned = jsxReturn(item.consequent[0]!);
    if (returned === null) return null;
    const index = branches.length;
    branches.push(returned.jsx);
    cases.push(
      t.switchCase(
        item.test === null ? null : t.cloneNode(item.test),
        [t.returnStatement(t.numericLiteral(index))],
      ),
    );
  }
  return {
    pick: t.arrowFunctionExpression(
      [],
      t.blockStatement([
        t.switchStatement(t.cloneNode(statement.discriminant), cases),
      ]),
    ),
    branches,
    statements: new Set([statement]),
  };
}

/**
 * Supported structural forms:
 * - one direct JSX return
 * - a contiguous tail chain of `if (test) return <JSX>` plus final return
 * - a terminal if/else whose two arms return JSX
 * - a terminal exhaustive switch whose cases return JSX
 */
export function analyzeComponentReturns(
  path: NodePath<t.FunctionDeclaration>,
  name: string,
): ComponentReturns {
  const body = path.node.body.body;
  const returns = componentReturns(path);
  const final = body.at(-1);

  if (returns.length === 1 && final !== undefined) {
    const direct = jsxReturn(final);
    if (direct !== null) return direct;
  }

  if (final && t.isIfStatement(final) && final.alternate != null) {
    const alternateStatement = final.alternate;
    const consequent = soleJsxReturn(final.consequent);
    const alternate = soleJsxReturn(alternateStatement);
    if (
      consequent !== null &&
      alternate !== null &&
      returns.length === 2
    ) {
      return {
        pick: t.arrowFunctionExpression(
          [],
          t.conditionalExpression(
            t.cloneNode(final.test),
            t.numericLiteral(0),
            t.numericLiteral(1),
          ),
        ),
        branches: [consequent.jsx, alternate.jsx],
        statements: new Set([final]),
      };
    }
  }

  if (final && t.isSwitchStatement(final)) {
    const plan = switchPlan(final);
    if (plan !== null && plan.branches.length === returns.length) return plan;
  }

  const fallback = final === undefined ? null : jsxReturn(final);
  if (fallback !== null) {
    const tests: t.Expression[] = [];
    const branches: JsxNode[] = [];
    const statements = new Set<t.Statement>([final!]);
    let firstEarlyReturn = -1;
    let hoistable = true;
    for (let index = 0; index < body.length - 1; index++) {
      const statement = body[index]!;
      if (t.isIfStatement(statement) && statement.alternate == null) {
        const returned = soleJsxReturn(statement.consequent);
        if (returned !== null) {
          if (firstEarlyReturn === -1) firstEarlyReturn = index;
          tests.push(t.cloneNode(statement.test));
          branches.push(returned.jsx);
          statements.add(statement);
          continue;
        }
      }
      if (
        firstEarlyReturn !== -1 &&
        !canHoistPastEarlyReturn(statement)
      ) {
        hoistable = false;
        break;
      }
    }
    branches.push(fallback.jsx);
    if (
      hoistable &&
      branches.length === returns.length &&
      branches.length > 1
    ) {
      let pick: t.Expression = t.numericLiteral(branches.length - 1);
      for (let index = tests.length - 1; index >= 0; index--) {
        pick = t.conditionalExpression(
          tests[index]!,
          t.numericLiteral(index),
          pick,
        );
      }
      return {
        pick: t.arrowFunctionExpression([], pick),
        branches,
        statements,
      };
    }
  }

  throw path.buildCodeFrameError(
    `memo-dom: component '${name}' has unsupported JSX return control flow; use a tail chain of JSX early returns, a terminal JSX if/else, or an exhaustive JSX switch`,
  );
}
