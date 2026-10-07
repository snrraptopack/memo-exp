/** Module source registration and lowering from explicit source plans. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {cloneNode} from '../../ast';
import type {Ctx} from '../../context';
import {mdd, type IdentifierOwner} from '../../identifiers';
import type {ModuleSourceStatementPlan} from '../../planning/module-sources';
import {carrySourceEffectInputs, sourceReplayConsumption} from '../../effects/source-inputs';

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
export function lowerModuleSourceDeclarations(
  ctx: Pick<Ctx, 'transparentModuleSources' | 'usesTransparentData' | 'compilerLifecycleCalls'> & IdentifierOwner,
  program: t.Program,
  plans: readonly ModuleSourceStatementPlan[],
): void {
  for (const {statement, sources} of plans) {
    const sourceDescriptions: t.Statement[] = [];
    const requestInputEffects: t.Statement[] = [];
    for (const source of sources) {
      const {name, key, declarator} = source;
      ctx.transparentModuleSources.set(name, key);
      ctx.usesTransparentData = true;
      const readSource = source.kind === 'read';
      const inputs = (): t.CallExpression['arguments'] => source.kind === 'read'
        ? [sourceReplayConsumption(cloneNode(source.replay, true))]
        : [source.target === undefined ? astFactory.nullLiteral() : cloneNode(source.target, true),
          ...(source.options === undefined ? [] : [cloneNode(source.options, true)])];
      if (source.inputs.length > 0) {
        const effectCall = astFactory.callExpression(astFactory.identifier('$effect'), [
          astFactory.arrowFunctionExpression(
            [],
            astFactory.callExpression(mdd(ctx, readSource
              ? 'rebindReadModuleSource'
              : 'rebindModuleSource'), [
              astFactory.callExpression(mdd(ctx, 'sourceRef'), [
                astFactory.stringLiteral(key),
              ]),
              ...inputs(),
            ]),
          ),
        ]);
        ctx.compilerLifecycleCalls.set(effectCall, 'effect');
        // Replay executes only for a materialized source. Its lexical inputs
        // still drive rebinding, including reads inside the returned promise.
        if (readSource) carrySourceEffectInputs(effectCall, source.inputs.map(input => input.name));
        requestInputEffects.push(astFactory.expressionStatement(effectCall));
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
                  astFactory.callExpression(mdd(ctx, readSource
                    ? 'createReadSource'
                    : source.bodyless ? source.clientOnly ? 'createClientSource' : 'createBodylessSource' : 'createSource'), readSource
                    ? [astFactory.callExpression(sourceReplayConsumption(cloneNode(source.replay, true)), []), ...inputs()]
                    : inputs()),
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
      const index = program.body.indexOf(statement);
      if (index !== -1) {
        program.body.splice(index, 0, ...sourceDescriptions);
      }
    }
    if (requestInputEffects.length > 0) {
      const index = program.body.indexOf(statement);
      if (index !== -1) {
        program.body.splice(index + 1, 0, ...requestInputEffects);
      }
    }
  }
}
