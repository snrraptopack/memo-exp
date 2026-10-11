/** Shared registration of module control-flow derivations. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import type { Ctx as AnalysisContext } from '../context';
import type { ComputedEmission } from './computeds';

export function emitModuleControlFlow(
  ctx: AnalysisContext,
  program: t.Program,
  target: ComputedEmission,
): void {
  for (const flow of ctx.moduleControlFlow) {
    const statementIndex = program.body.indexOf(flow.statement);
    if (statementIndex === -1) continue;
    const previous = new Map(
      flow.bindings.map((binding) => [binding, target.fresh(`${binding}Previous`)]),
    );
    const renderBody: t.Statement[] = [
      astFactory.variableDeclaration(
        'const',
        flow.bindings.map((binding) =>
          astFactory.variableDeclarator(
            cloneEstreeNode(previous.get(binding)!),
            astFactory.identifier(binding),
          ),
        ),
      ),
      cloneEstreeNode(flow.statement, true),
      ...flow.bindings.map((binding) =>
        astFactory.ifStatement(
          astFactory.callExpression(target.runtime('computedChanged'), [
            cloneEstreeNode(previous.get(binding)!),
            astFactory.identifier(binding),
          ]),
          astFactory.blockStatement([
            astFactory.expressionStatement(
              astFactory.callExpression(target.runtime('commitWrites'), [target.writes([binding])]),
            ),
          ]),
        ),
      ),
    ];
    const registration = astFactory.expressionStatement(
      astFactory.callExpression(target.runtime('registerEntity'), [
        astFactory.objectExpression([
          astFactory.objectProperty(
            astFactory.identifier('id'),
            astFactory.stringLiteral(flow.entityId),
          ),
          astFactory.objectProperty(
            astFactory.identifier('parent'),
            target.parent ?? astFactory.nullLiteral(),
          ),
          astFactory.objectProperty(
            astFactory.identifier('depth'),
            astFactory.unaryExpression('-', astFactory.numericLiteral(1)),
          ),
          astFactory.objectProperty(
            astFactory.identifier('render'),
            astFactory.arrowFunctionExpression([], astFactory.blockStatement(renderBody)),
          ),
        ]),
      ]),
    );
    if (target.defer)
      target.defer([
        registration,
        ...(target.initialize
          ? [
              astFactory.expressionStatement(
                astFactory.callExpression(target.runtime('markDirty'), [
                  astFactory.stringLiteral(flow.entityId),
                ]),
              ),
            ]
          : []),
      ]);
    else program.body.splice(statementIndex + 1, 0, registration);
  }
}
