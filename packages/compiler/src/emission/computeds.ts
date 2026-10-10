/** Shared module derivation emission; destinations supply their runtime names. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import type { Ctx } from '../context';

export interface ComputedEmission {
  fresh(name: string): t.Identifier;
  runtime(name: string): t.Expression;
  writes(keys: readonly string[]): t.Expression;
  parent?: t.Expression;
  /** Native hosts activate module entities inside their application scope. */
  defer?(statements: readonly t.Statement[]): void;
}

/**
 * R13: rewrite each computed declaration (`const` or `let` initialized from state)
 * into a `let` plus a depth-(-1) entity whose render recomputes and commits
 * 'x' downstream ONLY when the value actually changed (computedChanged).
 * Depth -1 guarantees the recompute renders BEFORE any reader in a commit.
 */
export function emitModuleComputeds(ctx: Ctx, program: t.Program, target: ComputedEmission): void {
  const computedPrefix = `${ctx.rootId}/$computed/${encodeURIComponent(ctx.moduleId)}#`;
  for (let statementIndex = 0; statementIndex < program.body.length; statementIndex++) {
    const statement = program.body[statementIndex]!;
    let declNode: t.Node | null | undefined = statement;
    if (astFactory.isExportNamedDeclaration(declNode)) declNode = declNode.declaration;
    if (!astFactory.isVariableDeclaration(declNode) ||
      (declNode.kind !== 'const' && declNode.kind !== 'let')) continue;
    const registrations: t.Statement[] = [];
    for (const d of declNode.declarations) {
      if (!astFactory.isIdentifier(d.id) || d.init == null) continue;
      const name = d.id.name;
      if (!ctx.computeds.has(name)) continue;
      declNode.kind = 'let';
      const init = cloneEstreeNode(d.init);
      const next = target.fresh(`${name}Next`);
      const registerStmt = astFactory.expressionStatement(
        astFactory.callExpression(target.runtime('registerEntity'), [
          astFactory.objectExpression([
            astFactory.objectProperty(
              astFactory.identifier('id'),
              astFactory.stringLiteral(`${computedPrefix}${name}`),
            ),
            astFactory.objectProperty(astFactory.identifier('parent'), target.parent ?? astFactory.nullLiteral()),
            astFactory.objectProperty(
              astFactory.identifier('depth'),
              astFactory.unaryExpression('-', astFactory.numericLiteral(1)),
            ),
            astFactory.objectProperty(
              astFactory.identifier('render'),
              astFactory.arrowFunctionExpression(
                [],
                astFactory.blockStatement([
                  astFactory.variableDeclaration('const', [
                    astFactory.variableDeclarator(next, init),
                  ]),
                  astFactory.ifStatement(
                    astFactory.callExpression(target.runtime('computedChanged'), [
                      astFactory.identifier(name),
                      cloneEstreeNode(next),
                    ]),
                    astFactory.blockStatement([
                      astFactory.expressionStatement(
                        astFactory.assignmentExpression('=', astFactory.identifier(name), cloneEstreeNode(next)),
                      ),
                      astFactory.expressionStatement(
                        astFactory.callExpression(target.runtime('commitWrites'), [target.writes([name])]),
                      ),
                    ]),
                  ),
                ]),
              ),
            ),
          ]),
        ]),
      );
      registrations.push(registerStmt);
    }
    if (registrations.length > 0) {
      if (target.defer) target.defer(registrations);
      else {
        program.body.splice(statementIndex + 1, 0, ...registrations);
        statementIndex += registrations.length;
      }
    }
  }
}
