/** Host-independent insertion of writes after authored normal completion. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { ESTREE_VISITOR_KEYS } from '../ast';

/** Commit after return expressions and authored finalizers on normal completion. */
export function appendScopeCommit(
  fn: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
  commit: t.Statement,
  fresh: (name: string) => t.Identifier,
): void {
  const body = astFactory.isBlockStatement(fn.body)
    ? fn.body.body
    : [astFactory.returnStatement(fn.body as t.Expression)];
  let directiveCount = 0;
  for (const statement of body) {
    if (!astFactory.isExpressionStatement(statement) ||
        !astFactory.isStringLiteral(statement.expression)) break;
    directiveCount++;
  }
  const authored = body.slice(directiveCount);
  if (authored.length === 1 && astFactory.isReturnStatement(authored[0])) {
    const result = fresh('returnValue');
    fn.body = astFactory.blockStatement([
      ...body.slice(0, directiveCount),
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          result,
          authored[0].argument ?? astFactory.unaryExpression('void', astFactory.numericLiteral(0), true),
        ),
      ]),
      commit,
      astFactory.returnStatement(astFactory.identifier(result.name)),
    ]);
    return;
  }
  const label = fresh('completion');
  const result = fresh('returnValue');
  const returns = rewriteReturns(astFactory.blockStatement(authored), label, result);
  if (returns === 0) {
    fn.body = astFactory.blockStatement([...body, commit]);
    return;
  }
  fn.body = astFactory.blockStatement([
    ...body.slice(0, directiveCount),
    astFactory.variableDeclaration('let', [astFactory.variableDeclarator(result)]),
    { type: 'LabeledStatement', label, body: astFactory.blockStatement(authored) } as t.Statement,
    commit,
    astFactory.returnStatement(astFactory.identifier(result.name)),
  ]);
}

function rewriteReturns(node: t.Node, label: t.Identifier, result: t.Identifier): number {
  let count = 0;
  for (const key of ESTREE_VISITOR_KEYS[node.type] ?? []) {
    const record = node as unknown as Record<string, unknown>;
    const child = record[key];
    if (Array.isArray(child)) {
      for (let index = 0; index < child.length; index++) {
        const item = child[index];
        if (!item || typeof item !== 'object' || !('type' in item)) continue;
        const current = item as t.Node;
        if (astFactory.isFunction(current)) continue;
        if (astFactory.isReturnStatement(current)) {
          const statements: t.Statement[] = [];
          if (current.argument !== null) {
            statements.push(astFactory.expressionStatement(
              astFactory.assignmentExpression('=', astFactory.identifier(result.name), current.argument),
            ));
          }
          statements.push({ type: 'BreakStatement', label: astFactory.identifier(label.name) } as t.Statement);
          child[index] = astFactory.blockStatement(statements);
          count++;
        } else {
          count += rewriteReturns(current, label, result);
        }
      }
    } else if (child && typeof child === 'object' && 'type' in child) {
      const current = child as t.Node;
      if (astFactory.isFunction(current)) continue;
      if (astFactory.isReturnStatement(current)) {
        const statements: t.Statement[] = [];
        if (current.argument !== null) {
          statements.push(astFactory.expressionStatement(
            astFactory.assignmentExpression('=', astFactory.identifier(result.name), current.argument),
          ));
        }
        statements.push({ type: 'BreakStatement', label: astFactory.identifier(label.name) } as t.Statement);
        record[key] = astFactory.blockStatement(statements);
        count++;
      } else {
        count += rewriteReturns(current, label, result);
      }
    }
  }
  return count;
}
