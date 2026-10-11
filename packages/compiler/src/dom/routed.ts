/** Browser ABI emission for the shared route-preparation analysis. */
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import type { ProgramPath } from '../context';
import type { DomContext } from './context';
import { mdd, mr } from './identifiers';
import { analyzeRoutedPreparations as analyze } from '../routed';

export function analyzeRoutedPreparations(ctx: DomContext, path: ProgramPath, lower = false) {
  return analyze(
    ctx,
    path,
    lower
      ? ({ preparation, callback: argument, declarator, usesTransparentSource }) => {
          const properties = [
            astFactory.objectProperty(
              astFactory.identifier('id'),
              astFactory.stringLiteral(preparation.id),
            ),
            astFactory.objectProperty(
              astFactory.identifier('server'),
              astFactory.booleanLiteral(preparation.server),
            ),
          ];
          if (!(ctx.routedEnvironment === 'client' && preparation.server)) {
            properties.push(
              astFactory.objectProperty(
                astFactory.identifier('prepare'),
                cloneEstreeNode(argument, true),
              ),
            );
          }
          if (
            usesTransparentSource &&
            !(ctx.routedEnvironment === 'client' && preparation.server)
          ) {
            properties.push(
              astFactory.objectProperty(
                astFactory.identifier('settle'),
                mdd(ctx, 'settleRoutedValue'),
              ),
            );
            ctx.usesTransparentData = true;
          }
          ctx.emission.header.push(
            astFactory.expressionStatement(
              astFactory.callExpression(mr(ctx, 'registerRoutedPreparation'), [
                astFactory.objectExpression(properties),
              ]),
            ),
          );
          declarator.init = astFactory.callExpression(mr(ctx, 'readRoutedPreparation'), [
            astFactory.stringLiteral(preparation.id),
          ]);
          ctx.usesRouter = true;
        }
      : undefined,
  );
}
