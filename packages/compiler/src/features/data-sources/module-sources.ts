/** Module-scope compiler-transparent source registration and lazy lowering. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {
  cloneNode,
  walkAst,
  type BaseNode,
  type Identifier,
} from '../../ast';
import {
  astBindingAt,
  refreshAstAnalysis,
  type Ctx,
} from '../../context';
import { mdd } from '../../identifiers';

/** Register source holders as push-owned roots for derivation analysis. */
export function registerTransparentSourceRoots(ctx: Ctx): void {
  for (const [component, sources] of ctx.transparentSources) {
    let roots = ctx.opaqueBindings.get(component);
    if (roots === undefined) {
      roots = new Set();
      ctx.opaqueBindings.set(component, roots);
    }
    for (const source of sources) roots.add(source);
  }
}

/** Lower module sources into lazy request-local descriptions and stable refs. */
export function scanAndLowerModuleSourceDeclarations(
  ctx: Ctx,
  programPath: { node: t.Program },
): void {
  refreshAstAnalysis(ctx, programPath.node);
  for (const statement of programPath.node.body.slice()) {
    const sourceDescriptions: t.Statement[] = [];
    const requestInputEffects: t.Statement[] = [];
    const inner = astFactory.isExportNamedDeclaration(statement)
      ? statement.declaration
      : statement;
    if (!astFactory.isVariableDeclaration(inner)) continue;
    for (const declarator of inner.declarations) {
      if (!astFactory.isIdentifier(declarator.id)) continue;
      if (!astFactory.isCallExpression(declarator.init)) continue;
      if (!astFactory.isIdentifier(declarator.init.callee)) continue;
      if (!ctx.transparentSourceFactories.has(declarator.init.callee.name)) {
        continue;
      }
      const binding = astBindingAt(
        ctx,
        declarator.init,
        declarator.init.callee.name,
      );
      if (binding?.kind !== 'import') continue;

      const name = declarator.id.name;
      const key = `${ctx.moduleId}#${name}`;
      ctx.transparentModuleSources.set(name, key);
      ctx.usesTransparentData = true;

      const target = declarator.init.arguments[0];
      const options = declarator.init.arguments[1];
      let readsProgramBinding = false;
      const noteProgramReads = (input: t.Node | undefined): void => {
        if (input === undefined) return;
        walkAst(input as unknown as BaseNode, {
          enter(node) {
            if (
              node.type === 'Identifier' &&
              astBindingAt(
                ctx,
                node,
                (node as unknown as Identifier).name,
              )?.scope.isProgramScope === true
            ) {
              readsProgramBinding = true;
            }
          },
        });
      };
      noteProgramReads(astFactory.isNode(target) ? target : undefined);
      noteProgramReads(astFactory.isNode(options) ? options : undefined);
      if (readsProgramBinding) {
        requestInputEffects.push(
          astFactory.expressionStatement(
            astFactory.callExpression(astFactory.identifier('effect'), [
              astFactory.arrowFunctionExpression(
                [],
                astFactory.callExpression(mdd(ctx, 'rebindModuleSource'), [
                  astFactory.callExpression(mdd(ctx, 'sourceRef'), [
                    astFactory.stringLiteral(key),
                  ]),
                  target === undefined
                    ? astFactory.nullLiteral()
                    : cloneNode(target, true),
                  ...(options === undefined
                    ? []
                    : [cloneNode(options, true)]),
                ]),
              ),
            ]),
          ),
        );
      }
      declarator.init = astFactory.callExpression(mdd(ctx, 'sourceRef'), [
        astFactory.stringLiteral(key),
      ]);
      sourceDescriptions.push(
        astFactory.expressionStatement(
          astFactory.callExpression(mdd(ctx, 'describeModuleSource'), [
            astFactory.stringLiteral(key),
            astFactory.arrowFunctionExpression(
              [],
              astFactory.blockStatement([
                astFactory.returnStatement(
                  astFactory.callExpression(mdd(ctx, 'createSource'), [
                    target === undefined
                      ? astFactory.nullLiteral()
                      : cloneNode(target),
                    ...(options === undefined ? [] : [cloneNode(options)]),
                  ]),
                ),
              ]),
            ),
          ]),
        ),
      );
    }
    if (sourceDescriptions.length > 0) {
      // Keep descriptions in the program so server cell lowering can rewrite
      // reactive request inputs to request-owned reads before final emission.
      const index = programPath.node.body.indexOf(statement);
      if (index !== -1) {
        programPath.node.body.splice(index, 0, ...sourceDescriptions);
      }
    }
    if (requestInputEffects.length > 0) {
      const index = programPath.node.body.indexOf(statement);
      if (index !== -1) {
        programPath.node.body.splice(index + 1, 0, ...requestInputEffects);
      }
    }
  }
}
