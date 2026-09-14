/**
 * Normalize supported JSX return control flow into one stable branch picker.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import {
  FUNCTION_NODE_TYPES as FUNCTION_NODES,
  walkAst,
  type BaseNode,
} from '../ast';
import type { JsxNode } from '../jsx/children';

interface ComponentFunctionContainer {
  node: t.FunctionDeclaration;
  buildCodeFrameError(message: string): Error;
}

const HOIST_BARRIERS = new Set([
  'AwaitExpression',
  'CallExpression',
  'NewExpression',
  'OptionalCallExpression',
  'TaggedTemplateExpression',
  'UpdateExpression',
  'YieldExpression',
]);

export interface ComponentReturnPlan {
  /** Branch picker passed directly to createCondRegion(). */
  pick: t.ArrowFunctionExpression;
  /** null marks an empty branch (`return null/false/undefined`). */
  branches: (JsxNode | null)[];
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
    !astFactory.isReturnStatement(statement) ||
    (!astFactory.isJSXElement(statement.argument) &&
      !astFactory.isJSXFragment(statement.argument))
  ) {
    return null;
  }
  return {
    jsx: statement.argument,
    statement,
  };
}

function isEmptyReturnArgument(
  argument: t.Expression | null | undefined,
): boolean {
  if (argument == null) return true;
  const candidate = argument as unknown as BaseNode & {
    name?: string;
    value?: unknown;
  };
  return (
    candidate.type === 'NullLiteral' ||
    (candidate.type === 'BooleanLiteral' && candidate.value === false) ||
    (candidate.type === 'Literal' &&
      (candidate.value === null || candidate.value === false)) ||
    (candidate.type === 'Identifier' && candidate.name === 'undefined')
  );
}

interface BranchReturn {
  /** null marks an empty branch (`return null/false/undefined`). */
  jsx: JsxNode | null;
  statement: t.ReturnStatement;
}

function branchReturn(statement: t.Statement): BranchReturn | null {
  if (!astFactory.isReturnStatement(statement)) return null;
  if (isEmptyReturnArgument(statement.argument)) {
    return { jsx: null, statement };
  }
  if (
    !astFactory.isJSXElement(statement.argument) &&
    !astFactory.isJSXFragment(statement.argument)
  ) {
    return null;
  }
  return { jsx: statement.argument, statement };
}

function soleBranchReturn(statement: t.Statement): BranchReturn | null {
  if (astFactory.isBlockStatement(statement)) {
    return statement.body.length === 1
      ? branchReturn(statement.body[0]!)
      : null;
  }
  return branchReturn(statement);
}

function componentReturns(
  path: ComponentFunctionContainer,
): t.ReturnStatement[] {
  const returns: t.ReturnStatement[] = [];
  walkAst<BaseNode>(path.node.body as unknown as BaseNode, {
    enter(node) {
      if (FUNCTION_NODES.has(node.type)) return false;
      if (node.type === 'ReturnStatement') {
        returns.push(node as unknown as t.ReturnStatement);
      }
    },
  });
  return returns;
}

function canHoistPastEarlyReturn(statement: t.Statement): boolean {
  if (astFactory.isFunctionDeclaration(statement)) return true;
  if (astFactory.isVariableDeclaration(statement)) {
    return statement.declarations.every(
      (declaration) =>
        declaration.init == null ||
        astFactory.isFunction(declaration.init) ||
        expressionCanHoist(declaration.init),
    );
  }
  if (astFactory.isSwitchStatement(statement) || astFactory.isIfStatement(statement)) {
    let safe = true;
    walkAst<BaseNode>(statement as unknown as BaseNode, {
      enter(node) {
        if (
          HOIST_BARRIERS.has(node.type) ||
          node.type === 'ThrowStatement'
        ) {
          safe = false;
        }
      },
    });
    return safe;
  }
  return astFactory.isTypeScript(statement);
}

function expressionCanHoist(expression: t.Expression): boolean {
  let safe = true;
  walkAst<BaseNode>(expression as unknown as BaseNode, {
    enter(node) {
      if (
        HOIST_BARRIERS.has(node.type) ||
        node.type === 'AssignmentExpression' ||
        (node.type === 'UnaryExpression' &&
          (node as unknown as { operator?: string }).operator === 'delete')
      ) {
        safe = false;
      }
    },
  });
  return safe;
}

function switchPlan(
  statement: t.SwitchStatement,
  returns: t.ReturnStatement[],
): ComponentReturnPlan | null {
  if (!statement.cases.some((item) => item.test == null)) return null;
  // Every function-level return must live inside the switch — a stray return
  // elsewhere would bypass the region pick entirely.
  const switchReturns = new Set<t.ReturnStatement>();
  walkAst<BaseNode>(statement as unknown as BaseNode, {
    enter(node) {
      if (FUNCTION_NODES.has(node.type)) return false;
      if (node.type === 'ReturnStatement') {
        switchReturns.add(node as unknown as t.ReturnStatement);
      }
    },
  });
  if (!returns.every((returned) => switchReturns.has(returned))) return null;
  const branches: (JsxNode | null)[] = [];
  const cases: t.SwitchCase[] = [];
  // The emitted pick keeps the authored switch shape, so the discriminant and
  // case tests re-evaluate with authored laziness on every region update —
  // the same reactivity semantics as JSX `{cond ? <A/> : <B/>}` sites.
  // Empty-consequent cases share the next non-empty case's branch
  // (fallthrough); a `break` exits the pick switch after its return.
  const pending: t.SwitchCase[] = [];
  const flushPending = (): void => {
    for (const pendingCase of pending) {
      cases.push(
        astFactory.switchCase(
          pendingCase.test == null
            ? null
            : cloneEstreeNode(pendingCase.test),
          [],
        ),
      );
    }
    pending.length = 0;
  };
  for (const item of statement.cases) {
    // Statements after a `break` are unreachable; only code before the first
    // break participates in the case.
    const breakAt = item.consequent.findIndex((part) =>
      astFactory.isBreakStatement(part),
    );
    const body =
      breakAt === -1 ? item.consequent : item.consequent.slice(0, breakAt);
    if (body.length === 0) {
      if (item.consequent.length === 0) {
        // Truly empty case: falls through to the next non-empty case.
        pending.push(item);
        continue;
      }
      // `case x: break` exits the switch — authored flow reaches the end of
      // the function and returns undefined: an empty branch.
      flushPending();
      const index = branches.length;
      branches.push(null);
      cases.push(
        astFactory.switchCase(
          item.test == null ? null : cloneEstreeNode(item.test),
          [astFactory.returnStatement(astFactory.numericLiteral(index))],
        ),
      );
      continue;
    }
    if (body.length !== 1) return null;
    const returned = soleBranchReturn(body[0]!);
    if (returned === null) return null;
    const index = branches.length;
    branches.push(returned.jsx);
    flushPending();
    cases.push(
      astFactory.switchCase(
        item.test == null ? null : cloneEstreeNode(item.test),
        [astFactory.returnStatement(astFactory.numericLiteral(index))],
      ),
    );
  }
  // Trailing empty cases fall off the switch — an empty (null) branch.
  if (pending.length > 0) {
    const index = branches.length;
    branches.push(null);
    for (const pendingCase of pending) {
      cases.push(
        astFactory.switchCase(
          pendingCase.test == null
            ? null
            : cloneEstreeNode(pendingCase.test),
          pendingCase === pending.at(-1)
            ? [astFactory.returnStatement(astFactory.numericLiteral(index))]
            : [],
        ),
      );
    }
    pending.length = 0;
  }
  if (branches.every((branch) => branch === null)) return null;
  return {
    pick: astFactory.arrowFunctionExpression(
      [],
      astFactory.blockStatement([
        astFactory.switchStatement(
          cloneEstreeNode(statement.discriminant),
          cases,
        ),
      ]),
    ),
    branches,
    statements: new Set([statement]),
  };
}

/**
 * Supported structural forms:
 * - one direct JSX return
 * - a contiguous tail chain of `if (test) return <JSX|null>` plus final return
 *   (empty returns become null branches)
 * - a terminal if/else whose two arms return JSX or an empty value
 * - a terminal exhaustive switch whose cases return JSX or an empty value
 */
export function analyzeComponentReturns(
  path: ComponentFunctionContainer,
  name: string,
): ComponentReturns {
  const body = path.node.body.body;
  const returns = componentReturns(path);
  const final = body.at(-1);

  if (returns.length === 1 && final !== undefined) {
    const direct = jsxReturn(final);
    if (direct !== null) return direct;
  }

  if (final && astFactory.isIfStatement(final) && final.alternate != null) {
    const alternateStatement = final.alternate;
    const consequent = soleBranchReturn(final.consequent);
    const alternate = soleBranchReturn(alternateStatement);
    if (
      consequent !== null &&
      alternate !== null &&
      (consequent.jsx !== null || alternate.jsx !== null) &&
      returns.length === 2
    ) {
      return {
        pick: astFactory.arrowFunctionExpression(
          [],
          astFactory.conditionalExpression(
            cloneEstreeNode(final.test),
            astFactory.numericLiteral(0),
            astFactory.numericLiteral(1),
          ),
        ),
        branches: [consequent.jsx, alternate.jsx],
        statements: new Set([final]),
      };
    }
  }

  if (final && astFactory.isSwitchStatement(final)) {
    const plan = switchPlan(final, returns);
    if (plan !== null) return plan;
  }

  const fallback = final === undefined ? null : branchReturn(final);
  if (fallback !== null) {
    const tests: t.Expression[] = [];
    const branches: (JsxNode | null)[] = [];
    const statements = new Set<t.Statement>([final!]);
    let firstEarlyReturn = -1;
    let hoistable = true;
    for (let index = 0; index < body.length - 1; index++) {
      const statement = body[index]!;
      if (astFactory.isIfStatement(statement) && statement.alternate == null) {
        const returned = soleBranchReturn(statement.consequent);
        if (returned !== null) {
          if (firstEarlyReturn === -1) firstEarlyReturn = index;
          tests.push(cloneEstreeNode(statement.test));
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
      branches.length > 1 &&
      branches.some((branch) => branch !== null)
    ) {
      let pick: t.Expression = astFactory.numericLiteral(branches.length - 1);
      for (let index = tests.length - 1; index >= 0; index--) {
        pick = astFactory.conditionalExpression(
          tests[index]!,
          astFactory.numericLiteral(index),
          pick,
        );
      }
      return {
        pick: astFactory.arrowFunctionExpression([], pick),
        branches,
        statements,
      };
    }
  }

  throw path.buildCodeFrameError(
    `memo-dom: component '${name}' has unsupported JSX return control flow; use a tail chain of JSX early returns, a terminal JSX if/else, or an exhaustive JSX switch`,
  );
}
