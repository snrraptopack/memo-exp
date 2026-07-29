/**
 * Compiler intrinsic `effect(() => ...)`.
 *
 * Effects are component-owned, statically subscribed callbacks. Their runtime
 * entities execute only after render entities have drained, and own the latest
 * teardown returned by the callback.
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  memberKey,
  memberRootName,
  type Ctx,
  type EffectSite,
  type ModuleEffectSite,
} from './context';
import { summarizeHelper } from './helper-summaries';
import { generatedIdentifier, md } from './identifiers';

import type { EmitScope } from './emission/scope';

function isIntrinsicEffect(
  call: NodePath<t.CallExpression>,
): boolean {
  return (
    t.isIdentifier(call.node.callee, { name: 'effect' }) &&
    call.scope.getBinding('effect') === undefined
  );
}

function effectId(factoryId: string, index: number): t.Expression {
  return t.binaryExpression(
    '+',
    t.identifier(factoryId),
    t.stringLiteral(`/$effects/${index}`),
  );
}

function collectEffectReads(
  ctx: Ctx,
  compName: string,
  compPath: NodePath<t.FunctionDeclaration>,
  callbackPath: NodePath<t.ArrowFunctionExpression | t.FunctionExpression>,
): Pick<EffectSite, 'moduleReads' | 'localReads' | 'localDerivationReads'> {
  const moduleReads = new Set<string>();
  const directLocalReads = new Set<string>();
  const bindings = new Map<unknown, { source: string; local: boolean }>();
  const localRoots = new Set<string>([
    ...(ctx.componentProps.get(compName)?.bindings ?? []),
    ...(ctx.instanceState.get(compName) ?? []),
  ]);
  const derivedSources = new Map<string, string[]>();

  for (const derivation of ctx.instanceDerivations.get(compName) ?? []) {
    for (const binding of derivation.bindings) {
      derivedSources.set(binding, derivation.sources);
    }
  }
  for (const derivation of ctx.instanceControlFlow.get(compName) ?? []) {
    for (const binding of derivation.bindings) {
      derivedSources.set(binding, derivation.sources);
    }
  }

  for (const name of localRoots) {
    const binding = compPath.scope.getBinding(name);
    if (binding !== undefined) {
      bindings.set(binding, { source: name, local: true });
    }
  }
  for (const name of derivedSources.keys()) {
    const binding = compPath.scope.getBinding(name);
    if (binding !== undefined) {
      bindings.set(binding, { source: name, local: true });
    }
  }
  for (const name of ctx.state.keys()) {
    const binding = compPath.scope.getBinding(name);
    if (binding?.scope.path.isProgram() === true) {
      bindings.set(binding, { source: name, local: false });
    }
  }

  const noteIdentifier = (path: NodePath<t.Identifier>): void => {
    const binding = path.scope.getBinding(path.node.name);
    const origin = binding === undefined ? undefined : bindings.get(binding);
    if (origin === undefined) return;

    // Store members are path-keyed by the MemberExpression visitor below.
    const parent = path.parentPath;
    if (
      !origin.local &&
      ctx.state.get(origin.source) === 'store' &&
      parent?.isMemberExpression() &&
      parent.node.object === path.node
    ) {
      return;
    }

    if (origin.local) directLocalReads.add(origin.source);
    else moduleReads.add(origin.source);
  };

  callbackPath.traverse({
    Function(path) {
      // Reads deferred into timers/promises/listeners are not dependencies of
      // the surrounding effect execution.
      path.skip();
    },
    ReferencedIdentifier(path) {
      if (path.isIdentifier()) noteIdentifier(path);
    },
    MemberExpression(path) {
      const key = memberKey(path.node);
      const root = memberRootName(path.node);
      if (
        key === null ||
        root === null ||
        ctx.state.get(root) !== 'store' ||
        path.scope.getBinding(root)?.scope.path.isProgram() !== true
      ) {
        return;
      }
      moduleReads.add(key);
    },
    CallExpression(path) {
      const callee = path.node.callee;
      if (
        !t.isIdentifier(callee) ||
        path.scope.getBinding(callee.name)?.scope.path.isProgram() !== true ||
        (!ctx.helpers.has(callee.name) &&
          !ctx.importedFunctions.has(callee.name))
      ) {
        return;
      }
      const summary =
        ctx.importedFunctions.get(callee.name) ??
        summarizeHelper(ctx, callee.name);
      for (const read of summary.reads) moduleReads.add(read);
    },
  });

  const localReads = new Set<string>();
  const localDerivationReads = new Set<string>();

  const rawDirectLocalReads = new Set<string>();
  for (const source of directLocalReads) {
    if (localRoots.has(source)) {
      rawDirectLocalReads.add(source);
    }
  }

  const expandLocal = (source: string, visiting: Set<string>): void => {
    if (visiting.has(source)) return;
    const upstream = derivedSources.get(source);
    if (upstream === undefined) {
      if (localRoots.has(source)) localReads.add(source);
      else if (ctx.state.has(source)) moduleReads.add(source);
      return;
    }
    visiting.add(source);
    const isDirectlyReadRaw = upstream.some((root) => rawDirectLocalReads.has(root));
    if (!isDirectlyReadRaw) {
      localDerivationReads.add(source);
    }
    for (const next of upstream) expandLocal(next, visiting);
    visiting.delete(source);
  };
  for (const source of directLocalReads) {
    expandLocal(source, new Set());
  }

  return { moduleReads, localReads, localDerivationReads };
}

function collectModuleEffectReads(
  ctx: Ctx,
  callbackPath: NodePath<t.ArrowFunctionExpression | t.FunctionExpression>,
): Set<string> {
  const reads = new Set<string>();
  const noteIdentifier = (path: NodePath<t.Identifier>): void => {
    const name = path.node.name;
    if (
      !ctx.state.has(name) ||
      path.scope.getBinding(name)?.scope.path.isProgram() !== true
    ) {
      return;
    }
    const parent = path.parentPath;
    if (
      ctx.state.get(name) === 'store' &&
      parent?.isMemberExpression() &&
      parent.node.object === path.node
    ) {
      return;
    }
    reads.add(name);
  };

  callbackPath.traverse({
    Function(path) {
      path.skip();
    },
    ReferencedIdentifier(path) {
      if (path.isIdentifier()) noteIdentifier(path);
    },
    MemberExpression(path) {
      const key = memberKey(path.node);
      const root = memberRootName(path.node);
      if (
        key !== null &&
        root !== null &&
        ctx.state.get(root) === 'store' &&
        path.scope.getBinding(root)?.scope.path.isProgram() === true
      ) {
        reads.add(key);
      }
    },
    CallExpression(path) {
      const callee = path.node.callee;
      if (
        !t.isIdentifier(callee) ||
        path.scope.getBinding(callee.name)?.scope.path.isProgram() !== true ||
        (!ctx.helpers.has(callee.name) &&
          !ctx.importedFunctions.has(callee.name))
      ) {
        return;
      }
      const summary =
        ctx.importedFunctions.get(callee.name) ??
        summarizeHelper(ctx, callee.name);
      for (const read of summary.reads) reads.add(read);
    },
  });
  return reads;
}

function scanModuleEffects(
  ctx: Ctx,
  programPath: NodePath<t.Program>,
): void {
  const sites: ModuleEffectSite[] = [];
  for (const statementPath of programPath.get('body')) {
    if (!statementPath.isExpressionStatement()) continue;
    const expressionPath = statementPath.get('expression');
    if (!expressionPath.isCallExpression() || !isIntrinsicEffect(expressionPath)) {
      continue;
    }
    const args = expressionPath.get('arguments');
    const callbackPath = args[0];
    if (
      args.length !== 1 ||
      callbackPath === undefined ||
      (!callbackPath.isArrowFunctionExpression() &&
        !callbackPath.isFunctionExpression())
    ) {
      throw expressionPath.buildCodeFrameError(
        'memo-dom: effect() requires exactly one inline callback',
      );
    }
    if (callbackPath.node.async || callbackPath.node.generator) {
      throw callbackPath.buildCodeFrameError(
        'memo-dom: effect callback must be synchronous; start async work inside it and return a synchronous teardown',
      );
    }
    const index = sites.length;
    sites.push({
      index,
      statement: statementPath.node,
      callback: callbackPath.node,
      moduleReads: collectModuleEffectReads(ctx, callbackPath),
      entityId:
        `${ctx.rootId}/$module-effects/` +
        `${encodeURIComponent(ctx.moduleId)}/${index}`,
    });
  }
  ctx.moduleEffects.push(...sites);
}

/**
 * Discover and validate direct component-body effect statements.
 */
export function scanEffects(
  ctx: Ctx,
  programPath: NodePath<t.Program>,
): void {
  scanModuleEffects(ctx, programPath);
  for (const [compName, compPath] of ctx.compPaths) {
    const sites: EffectSite[] = [];
    const accepted = new Set<t.CallExpression>();

    for (const statementPath of compPath.get('body').get('body')) {
      if (!statementPath.isExpressionStatement()) continue;
      const expressionPath = statementPath.get('expression');
      if (!expressionPath.isCallExpression() || !isIntrinsicEffect(expressionPath)) {
        continue;
      }

      const args = expressionPath.get('arguments');
      const callbackPath = args[0];
      if (
        args.length !== 1 ||
        callbackPath === undefined ||
        (!callbackPath.isArrowFunctionExpression() &&
          !callbackPath.isFunctionExpression())
      ) {
        throw expressionPath.buildCodeFrameError(
          'memo-dom: effect() requires exactly one inline callback',
        );
      }
      if (callbackPath.node.async || callbackPath.node.generator) {
        throw callbackPath.buildCodeFrameError(
          'memo-dom: effect callback must be synchronous; start async work inside it and return a synchronous teardown',
        );
      }

      const reads = collectEffectReads(
        ctx,
        compName,
        compPath,
        callbackPath,
      );
      sites.push({
        index: sites.length,
        statement: statementPath.node,
        callback: callbackPath.node,
        ...reads,
      });
      accepted.add(expressionPath.node);
    }

    compPath.traverse({
      CallExpression(path) {
        if (!isIntrinsicEffect(path) || accepted.has(path.node)) return;
        throw path.buildCodeFrameError(
          'memo-dom: effect() must be a direct top-level statement in a component body',
        );
      },
    });

    if (sites.length === 0) continue;
    ctx.effects.set(compName, sites);

    const reasonSources = new Set<string>([
      ...(ctx.instanceReasonIds.get(compName)?.keys() ?? []),
      ...(ctx.instanceState.get(compName) ?? []),
      ...(ctx.componentProps.get(compName)?.bindings ?? []),
      ...sites.flatMap((site) => [...site.localReads]),
    ]);
    if (reasonSources.size > 0) {
      ctx.instanceReasonIds.set(
        compName,
        new Map(
          [...reasonSources]
            .sort()
            .map((source, index) => [source, index]),
        ),
      );
    }
  }
}

function or(expressions: t.Expression[]): t.Expression {
  return expressions.reduce((left, right) =>
    t.logicalExpression('||', left, right),
  );
}

function localEffectCondition(
  ctx: Ctx,
  component: string,
  reasonVar: string,
  site: EffectSite,
): t.Expression | null {
  const reasonIds = ctx.instanceReasonIds.get(component);
  if (reasonIds === undefined) return null;
  const reasons = [...site.localReads]
    .map((source) => reasonIds.get(source))
    .filter((reason): reason is number => reason !== undefined)
    .sort((a, b) => a - b);
  if (reasons.length === 0 || reasons.length !== site.localReads.size) {
    return null;
  }
  const current = (): t.Identifier => t.identifier(reasonVar);
  const numberMatch = or(
    reasons.map((reason) =>
      t.binaryExpression('===', current(), t.numericLiteral(reason)),
    ),
  );
  const setMatch = or(
    reasons.map((reason) =>
      t.callExpression(
        t.memberExpression(current(), t.identifier('has')),
        [t.numericLiteral(reason)],
      ),
    ),
  );
  return t.logicalExpression(
    '||',
    t.binaryExpression('===', current(), t.nullLiteral()),
    t.conditionalExpression(
      t.binaryExpression(
        '===',
        t.unaryExpression('typeof', current()),
        t.stringLiteral('number'),
      ),
      numberMatch,
      setMatch,
    ),
  );
}

/**
 * Dirty local/prop-dependent effect entities after the owner's DOM update.
 */
export function buildLocalEffectInvalidations(
  ctx: Ctx,
  component: string,
  factoryId: string,
  reasonVar: string | null,
  sites: EffectSite[],
  scope?: EmitScope,
): t.Statement {
  const statements = sites
    .filter(
      (site) => site.localReads.size > 0 || site.localDerivationReads.size > 0,
    )
    .map((site) => {
      let mark: t.Statement = t.expressionStatement(
        t.callExpression(md(ctx, 'markDirty'), [
          effectId(factoryId, site.index),
        ]),
      );

      if (site.localDerivationReads.size > 0 && scope !== undefined) {
        const checks: t.Expression[] = [];
        const updates: t.Statement[] = [];

        for (const derivName of site.localDerivationReads) {
          const slotName = generatedIdentifier(
            ctx,
            `eff${site.index}_${derivName}`,
          ).name;
          scope.creation.push(
            t.variableDeclaration('let', [
              t.variableDeclarator(
                t.identifier(slotName),
                t.identifier(derivName),
              ),
            ]),
          );
          checks.push(
            t.binaryExpression(
              '!==',
              t.identifier(slotName),
              t.identifier(derivName),
            ),
          );
          updates.push(
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.identifier(slotName),
                t.identifier(derivName),
              ),
            ),
          );
        }

        const condition =
          checks.length === 1
            ? checks[0]!
            : checks.reduce((left, right) =>
                t.logicalExpression('||', left, right),
              );

        mark = t.ifStatement(
          condition,
          t.blockStatement([...updates, mark]),
        );
      }

      if (reasonVar === null) return mark;
      const condition = localEffectCondition(
        ctx,
        component,
        reasonVar,
        site,
      );
      return condition === null ? mark : t.ifStatement(condition, mark);
    });
  return t.blockStatement(statements);
}

/** Runtime registrations emitted after the owner's DOM creation statements. */
export function buildEffectRegistrations(
  ctx: Ctx,
  factoryId: string,
  sites: EffectSite[],
): t.Statement[] {
  return sites.map((site) =>
    t.expressionStatement(
      t.callExpression(md(ctx, 'registerEffect'), [
        effectId(factoryId, site.index),
        t.identifier(factoryId),
        t.cloneNode(site.callback, true),
      ]),
    ),
  );
}

function importMetaHot(): t.MemberExpression {
  return t.memberExpression(
    t.metaProperty(t.identifier('import'), t.identifier('meta')),
    t.identifier('hot'),
  );
}

/** Lower direct module effects to stable singleton registrations. */
export function rewriteModuleEffects(
  ctx: Ctx,
  programPath: NodePath<t.Program>,
): void {
  if (ctx.moduleEffects.length === 0) return;
  const statementPaths = new Map(
    programPath.get('body').map((statementPath) => [
      statementPath.node,
      statementPath,
    ]),
  );
  for (const site of ctx.moduleEffects) {
    const statementPath = statementPaths.get(site.statement);
    if (statementPath === undefined) continue;
    const registration = t.expressionStatement(
      t.callExpression(md(ctx, 'registerEffect'), [
        t.stringLiteral(site.entityId),
        t.nullLiteral(),
        t.cloneNode(site.callback, true),
      ]),
    );
    const hmrCleanup = t.ifStatement(
      importMetaHot(),
      t.expressionStatement(
        t.callExpression(
          t.memberExpression(importMetaHot(), t.identifier('dispose')),
          [
            t.arrowFunctionExpression(
              [],
              t.callExpression(md(ctx, 'unregisterSubtree'), [
                t.stringLiteral(site.entityId),
              ]),
            ),
          ],
        ),
      ),
    );
    statementPath.replaceWithMultiple([registration, hmrCleanup]);
  }
}

/** Reject effect syntax that was not consumed by component emission. */
export function rejectUnownedEffects(
  programPath: NodePath<t.Program>,
): void {
  programPath.traverse({
    CallExpression(path) {
      if (isIntrinsicEffect(path)) {
        throw path.buildCodeFrameError(
          'memo-dom: effect() is only valid as a direct top-level statement in a component body',
        );
      }
    },
  });
}
