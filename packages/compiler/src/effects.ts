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
  nodeHasJsx,
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

function activeEffectId(factoryId: string, index: number): t.Expression {
  return t.binaryExpression(
    '+',
    effectId(factoryId, index),
    t.stringLiteral('/$active'),
  );
}

type EffectFunctionPath = NodePath<
  t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration
>;

interface ResolvedEffectCallback {
  expression: t.Expression;
  path: EffectFunctionPath | null;
  importedReads: Set<string>;
}

function functionPathFromBinding(path: NodePath): EffectFunctionPath | null {
  if (path.isFunctionDeclaration()) return path;
  if (!path.isVariableDeclarator()) return null;
  const initializer = path.get('init');
  return initializer.isArrowFunctionExpression() ||
    initializer.isFunctionExpression()
    ? initializer
    : null;
}

function resolveEffectCallback(
  ctx: Ctx,
  callPath: NodePath<t.CallExpression>,
): ResolvedEffectCallback {
  const args = callPath.get('arguments');
  const argumentPath = args[0];
  if (args.length !== 1 || argumentPath === undefined) {
    throw callPath.buildCodeFrameError(
      'memo-dom: effect() requires exactly one callback',
    );
  }
  if (
    argumentPath.isArrowFunctionExpression() ||
    argumentPath.isFunctionExpression()
  ) {
    if (argumentPath.node.async || argumentPath.node.generator) {
      throw argumentPath.buildCodeFrameError(
        'memo-dom: effect callback must be synchronous; start async work inside it and return a synchronous teardown',
      );
    }
    return {
      expression: argumentPath.node,
      path: argumentPath,
      importedReads: new Set(),
    };
  }
  if (!argumentPath.isIdentifier()) {
    throw argumentPath.buildCodeFrameError(
      'memo-dom: effect callback must be an inline function or a resolvable function identifier',
    );
  }

  const imported = ctx.importedFunctions.get(argumentPath.node.name);
  if (imported !== undefined) {
    throw argumentPath.buildCodeFrameError(
      `memo-dom: imported named effect callback '${argumentPath.node.name}' is not supported yet; define a local synchronous wrapper so its cleanup and writes can be instrumented`,
    );
  }

  const binding = argumentPath.scope.getBinding(argumentPath.node.name);
  const callbackPath =
    binding === undefined ? null : functionPathFromBinding(binding.path);
  if (callbackPath === null) {
    throw argumentPath.buildCodeFrameError(
      `memo-dom: cannot resolve effect callback '${argumentPath.node.name}' — use an inline function or a local/module-level function declaration or const`,
    );
  }
  if (callbackPath.node.async || callbackPath.node.generator) {
    throw callbackPath.buildCodeFrameError(
      'memo-dom: effect callback must be synchronous; start async work inside it and return a synchronous teardown',
    );
  }
  if (nodeHasJsx(callbackPath.node.body)) {
    throw callbackPath.buildCodeFrameError(
      'memo-dom: a JSX component cannot be used as an effect callback',
    );
  }
  return {
    expression: t.cloneNode(argumentPath.node),
    path: callbackPath,
    importedReads: new Set(),
  };
}

function collectEffectReads(
  ctx: Ctx,
  compName: string,
  compPath: NodePath<t.FunctionDeclaration>,
  rootPath: NodePath,
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

  const noteMember = (path: NodePath<t.MemberExpression>): void => {
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
  };

  const noteCall = (path: NodePath<t.CallExpression>): void => {
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
  };

  if (rootPath.isIdentifier() && rootPath.isReferencedIdentifier()) {
    noteIdentifier(rootPath);
  }
  if (rootPath.isMemberExpression()) noteMember(rootPath);
  if (rootPath.isCallExpression()) noteCall(rootPath);

  rootPath.traverse({
    Function(path) {
      // Reads deferred into timers/promises/listeners are not dependencies of
      // the surrounding effect execution.
      path.skip();
    },
    ReferencedIdentifier(path) {
      if (path.isIdentifier()) noteIdentifier(path);
    },
    MemberExpression(path) {
      noteMember(path);
    },
    CallExpression(path) {
      noteCall(path);
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
  rootPath: NodePath,
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

  const noteMember = (path: NodePath<t.MemberExpression>): void => {
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
  };
  const noteCall = (path: NodePath<t.CallExpression>): void => {
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
  };

  if (rootPath.isIdentifier() && rootPath.isReferencedIdentifier()) {
    noteIdentifier(rootPath);
  }
  if (rootPath.isMemberExpression()) noteMember(rootPath);
  if (rootPath.isCallExpression()) noteCall(rootPath);

  rootPath.traverse({
    Function(path) {
      path.skip();
    },
    ReferencedIdentifier(path) {
      if (path.isIdentifier()) noteIdentifier(path);
    },
    MemberExpression(path) {
      noteMember(path);
    },
    CallExpression(path) {
      noteCall(path);
    },
  });
  return reads;
}

interface EffectConditionPath {
  path: NodePath<t.Expression>;
  negated: boolean;
}

interface OwnedEffectCall {
  callPath: NodePath<t.CallExpression>;
  rootStatement: t.Statement;
  conditions: EffectConditionPath[];
}

function directEffectCall(
  statementPath: NodePath<t.Statement>,
): NodePath<t.CallExpression> | null {
  if (!statementPath.isExpressionStatement()) return null;
  const expressionPath = statementPath.get('expression');
  return expressionPath.isCallExpression() && isIntrinsicEffect(expressionPath)
    ? expressionPath
    : null;
}

function containsOwnedEffect(statementPath: NodePath<t.Statement>): boolean {
  if (directEffectCall(statementPath) !== null) return true;
  let found = false;
  statementPath.traverse({
    Function(path) {
      path.skip();
    },
    CallExpression(path) {
      if (isIntrinsicEffect(path)) {
        found = true;
        path.stop();
      }
    },
  });
  return found;
}

function collectOwnedEffectCalls(
  statementPath: NodePath<t.Statement>,
  rootStatement: t.Statement,
  conditions: EffectConditionPath[],
  output: OwnedEffectCall[],
): void {
  const direct = directEffectCall(statementPath);
  if (direct !== null) {
    output.push({
      callPath: direct,
      rootStatement,
      conditions: [...conditions],
    });
    return;
  }
  if (statementPath.isEmptyStatement()) return;
  if (statementPath.isBlockStatement()) {
    for (const childPath of statementPath.get('body')) {
      if (childPath.isEmptyStatement()) continue;
      if (!containsOwnedEffect(childPath)) {
        throw childPath.buildCodeFrameError(
          'memo-dom: a conditional effect branch may contain only effect() calls, nested if statements, or empty statements',
        );
      }
      collectOwnedEffectCalls(
        childPath,
        rootStatement,
        conditions,
        output,
      );
    }
    return;
  }
  if (statementPath.isIfStatement()) {
    const testPath = statementPath.get('test') as NodePath<t.Expression>;
    collectOwnedEffectCalls(
      statementPath.get('consequent'),
      rootStatement,
      [...conditions, { path: testPath, negated: false }],
      output,
    );
    const alternatePath = statementPath.get('alternate');
    if (alternatePath.node !== null) {
      collectOwnedEffectCalls(
        alternatePath as NodePath<t.Statement>,
        rootStatement,
        [...conditions, { path: testPath, negated: true }],
        output,
      );
    }
    return;
  }
  throw statementPath.buildCodeFrameError(
    'memo-dom: conditional effect() calls must be controlled by top-level if statements',
  );
}

function discoverOwnedEffectCalls(
  statementPaths: NodePath<t.Statement>[],
): OwnedEffectCall[] {
  const output: OwnedEffectCall[] = [];
  for (const statementPath of statementPaths) {
    const direct = directEffectCall(statementPath);
    if (direct !== null) {
      output.push({
        callPath: direct,
        rootStatement: statementPath.node,
        conditions: [],
      });
      continue;
    }
    if (!statementPath.isIfStatement() || !containsOwnedEffect(statementPath)) {
      continue;
    }
    collectOwnedEffectCalls(
      statementPath,
      statementPath.node,
      [],
      output,
    );
  }
  return output;
}

function combinedCondition(
  conditions: EffectConditionPath[],
): t.Expression | null {
  if (conditions.length === 0) return null;
  const expressions = conditions.map(({ path, negated }) =>
    negated
      ? t.unaryExpression('!', t.cloneNode(path.node, true))
      : t.cloneNode(path.node, true),
  );
  return expressions.reduce((left, right) =>
    t.logicalExpression('&&', left, right),
  );
}

function scanModuleEffects(
  ctx: Ctx,
  programPath: NodePath<t.Program>,
): void {
  const sites: ModuleEffectSite[] = [];
  const occurrences = discoverOwnedEffectCalls(
    programPath.get('body') as NodePath<t.Statement>[],
  );
  for (const occurrence of occurrences) {
    const resolved = resolveEffectCallback(ctx, occurrence.callPath);
    const moduleReads =
      resolved.path === null
        ? resolved.importedReads
        : collectModuleEffectReads(ctx, resolved.path);
    const conditionModuleReads = new Set<string>();
    for (const condition of occurrence.conditions) {
      for (const read of collectModuleEffectReads(ctx, condition.path)) {
        conditionModuleReads.add(read);
      }
    }
    const index = sites.length;
    sites.push({
      index,
      statement: occurrence.rootStatement,
      callback: resolved.expression,
      moduleReads,
      condition: combinedCondition(occurrence.conditions),
      conditionModuleReads,
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
    const occurrences = discoverOwnedEffectCalls(
      compPath.get('body').get('body') as NodePath<t.Statement>[],
    );

    for (const occurrence of occurrences) {
      const resolved = resolveEffectCallback(ctx, occurrence.callPath);
      const reads =
        resolved.path === null
          ? {
              moduleReads: resolved.importedReads,
              localReads: new Set<string>(),
              localDerivationReads: new Set<string>(),
            }
          : collectEffectReads(
              ctx,
              compName,
              compPath,
              resolved.path,
            );
      const conditionModuleReads = new Set<string>();
      const conditionLocalReads = new Set<string>();
      const conditionLocalDerivationReads = new Set<string>();
      for (const condition of occurrence.conditions) {
        const conditionReads = collectEffectReads(
          ctx,
          compName,
          compPath,
          condition.path,
        );
        for (const read of conditionReads.moduleReads) {
          conditionModuleReads.add(read);
        }
        for (const read of conditionReads.localReads) {
          conditionLocalReads.add(read);
        }
        for (const read of conditionReads.localDerivationReads) {
          conditionLocalDerivationReads.add(read);
        }
      }
      sites.push({
        index: sites.length,
        statement: occurrence.rootStatement,
        callback: resolved.expression,
        ...reads,
        condition: combinedCondition(occurrence.conditions),
        conditionModuleReads,
        conditionLocalReads,
        conditionLocalDerivationReads,
      });
      accepted.add(occurrence.callPath.node);
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
      ...sites.flatMap((site) => [...site.conditionLocalReads]),
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
  reads: Set<string>,
): t.Expression | null {
  const reasonIds = ctx.instanceReasonIds.get(component);
  if (reasonIds === undefined) return null;
  const reasons = [...reads]
    .map((source) => reasonIds.get(source))
    .filter((reason): reason is number => reason !== undefined)
    .sort((a, b) => a - b);
  if (reasons.length === 0 || reasons.length !== reads.size) {
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

/** A pull-only frame is not evidence that any effect dependency was written. */
function volatilePullOnly(reasonVar: string): t.Expression {
  const current = (): t.Identifier => t.identifier(reasonVar);
  return t.logicalExpression(
    '||',
    t.binaryExpression('===', current(), t.unaryExpression('-', t.numericLiteral(1))),
    t.logicalExpression(
      '&&',
      t.logicalExpression(
        '&&',
        t.binaryExpression('!==', current(), t.nullLiteral()),
        t.binaryExpression(
          '!==',
          t.unaryExpression('typeof', current()),
          t.stringLiteral('number'),
        ),
      ),
      t.logicalExpression(
        '&&',
        t.binaryExpression(
          '===',
          t.memberExpression(current(), t.identifier('size')),
          t.numericLiteral(1),
        ),
        t.callExpression(
          t.memberExpression(current(), t.identifier('has')),
          [t.unaryExpression('-', t.numericLiteral(1))],
        ),
      ),
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
  const buildMark = (
    site: EffectSite,
    target: t.Expression,
    localReads: Set<string>,
    derivationReads: Set<string>,
    label: string,
  ): t.Statement | null => {
      if (localReads.size === 0 && derivationReads.size === 0) return null;
      let mark: t.Statement = t.expressionStatement(
        t.callExpression(md(ctx, 'markDirty'), [
          target,
        ]),
      );

      if (derivationReads.size > 0 && scope !== undefined) {
        const checks: t.Expression[] = [];
        const updates: t.Statement[] = [];

        for (const derivName of derivationReads) {
          const slotName = generatedIdentifier(
            ctx,
            `eff${site.index}_${label}_${derivName}`,
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
        localReads,
      );
      const routed = condition === null ? mark : t.ifStatement(condition, mark);
      return t.ifStatement(
        t.unaryExpression('!', volatilePullOnly(reasonVar)),
        routed,
      );
  };

  const statements = sites.flatMap((site) => {
    const conditionMark =
      site.condition === null
        ? null
        : buildMark(
            site,
            effectId(factoryId, site.index),
            site.conditionLocalReads,
            site.conditionLocalDerivationReads,
            'condition',
          );
    const callbackMark = buildMark(
      site,
      site.condition === null
        ? effectId(factoryId, site.index)
        : activeEffectId(factoryId, site.index),
      site.localReads,
      site.localDerivationReads,
      'callback',
    );
    return [conditionMark, callbackMark].filter(
      (statement): statement is t.Statement => statement !== null,
    );
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
      t.callExpression(
        md(
          ctx,
          site.condition === null
            ? 'registerEffect'
            : 'registerConditionalEffect',
        ),
        [
          effectId(factoryId, site.index),
          t.identifier(factoryId),
          ...(site.condition === null
            ? []
            : [
                t.arrowFunctionExpression(
                  [],
                  t.cloneNode(site.condition, true),
                ),
              ]),
          t.cloneNode(site.callback, true),
        ],
      ),
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
  const grouped = new Map<t.Statement, ModuleEffectSite[]>();
  for (const site of ctx.moduleEffects) {
    const sites = grouped.get(site.statement) ?? [];
    sites.push(site);
    grouped.set(site.statement, sites);
  }
  for (const [statement, sites] of grouped) {
    const statementPath = statementPaths.get(statement);
    if (statementPath === undefined) continue;
    const replacements: t.Statement[] = [];
    for (const site of sites) {
      replacements.push(
        t.expressionStatement(
          t.callExpression(
            md(
              ctx,
              site.condition === null
                ? 'registerEffect'
                : 'registerConditionalEffect',
            ),
            [
              t.stringLiteral(site.entityId),
              t.nullLiteral(),
              ...(site.condition === null
                ? []
                : [
                    t.arrowFunctionExpression(
                      [],
                      t.cloneNode(site.condition, true),
                    ),
                  ]),
              t.cloneNode(site.callback, true),
            ],
          ),
        ),
        t.ifStatement(
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
        ),
      );
    }
    statementPath.replaceWithMultiple(replacements);
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
          'memo-dom: effect() must be a direct top-level statement or be controlled by a top-level effect-only if branch in a component or module',
        );
      }
    },
  });
}
