/**
 * Compiler intrinsic `effect(() => ...)`.
 *
 * Effects are component-owned, statically subscribed callbacks. Their runtime
 * entities execute only after render entities have drained, and own the latest
 * teardown returned by the callback.
 */

import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import { cloneNode as cloneEstreeNode } from './ast';
import {
  childNode,
  childNodes,
  cloneNode,
  identifierName,
  nodeFields as fields,
  walkAst,
  type BaseNode,
  type Binding,
  type Identifier,
} from './ast';
import {
  astBindingAt,
  memberKey,
  memberRootName,
  nodeHasJsx,
  refreshAstAnalysis,
  variableDeclaratorFor,
  type Ctx,
  type EffectSite,
  type ModuleEffectSite,
} from './context';
import { summarizeHelper } from './helper-summaries';
import { generatedIdentifier, md } from './identifiers';

import type { EmitScope } from './emission/scope';

interface DiagnosticPath<TNode extends BaseNode = BaseNode> {
  node: TNode;
  buildCodeFrameError(message: string): Error;
}

type ProgramPath = DiagnosticPath<BaseNode & { type: 'Program' }>;
type ComponentPath = DiagnosticPath<
  BaseNode & { type: 'FunctionDeclaration'; body: BaseNode }
>;

function isIntrinsicEffect(
  ctx: Ctx,
  call: BaseNode,
): boolean {
  const callee = childNode(call, 'callee');
  return (
    call.type === 'CallExpression' &&
    identifierName(callee) === 'effect' &&
    astBindingAt(ctx, call, 'effect') === undefined
  );
}

function effectId(factoryId: string, index: number): t.Expression {
  return astFactory.binaryExpression(
    '+',
    astFactory.identifier(factoryId),
    astFactory.stringLiteral(`/$effects/${index}`),
  );
}

function activeEffectId(factoryId: string, index: number): t.Expression {
  return astFactory.binaryExpression(
    '+',
    effectId(factoryId, index),
    astFactory.stringLiteral('/$active'),
  );
}

type EffectFunctionNode =
  | t.ArrowFunctionExpression
  | t.FunctionExpression
  | t.FunctionDeclaration;

interface ResolvedEffectCallback {
  expression: t.Expression;
  node: EffectFunctionNode | null;
  importedReads: Set<string>;
}

function functionNodeFromBinding(
  ctx: Ctx,
  binding: Binding,
): EffectFunctionNode | null {
  if (
    binding.kind === 'function' &&
    binding.declarationNode.type === 'FunctionDeclaration'
  ) {
    return binding.declarationNode as unknown as t.FunctionDeclaration;
  }
  if (
    binding.kind !== 'const' &&
    binding.kind !== 'let' &&
    binding.kind !== 'var'
  ) {
    return null;
  }
  const declaration = variableDeclaratorFor(ctx, binding);
  const initializer = declaration === null
    ? null
    : childNode(declaration, 'init');
  return initializer !== null &&
    (initializer.type === 'ArrowFunctionExpression' ||
      initializer.type === 'FunctionExpression')
    ? initializer as unknown as t.ArrowFunctionExpression | t.FunctionExpression
    : null;
}

function resolveEffectCallback(
  ctx: Ctx,
  call: BaseNode,
  errorAt: DiagnosticPath,
): ResolvedEffectCallback {
  const args = childNodes(call, 'arguments');
  const argument = args[0];
  if (args.length !== 1 || argument === undefined) {
    throw errorAt.buildCodeFrameError(
      'memo-dom: effect() requires exactly one callback',
    );
  }
  if (
    argument.type === 'ArrowFunctionExpression' ||
    argument.type === 'FunctionExpression'
  ) {
    if (fields(argument).async === true || fields(argument).generator === true) {
      throw errorAt.buildCodeFrameError(
        'memo-dom: effect callback must be synchronous; start async work inside it and return a synchronous teardown',
      );
    }
    return {
      expression: argument as unknown as t.Expression,
      node: argument as unknown as EffectFunctionNode,
      importedReads: new Set(),
    };
  }
  const argumentName = identifierName(argument);
  if (argumentName === null) {
    throw errorAt.buildCodeFrameError(
      'memo-dom: effect callback must be an inline function or a resolvable function identifier',
    );
  }

  const imported = ctx.importedFunctions.get(argumentName);
  if (imported !== undefined) {
    throw errorAt.buildCodeFrameError(
      `memo-dom: imported named effect callback '${argumentName}' is not supported yet; define a local synchronous wrapper so its cleanup and writes can be instrumented`,
    );
  }

  const binding = astBindingAt(ctx, argument, argumentName);
  const callback =
    binding === undefined ? null : functionNodeFromBinding(ctx, binding);
  if (callback === null) {
    throw errorAt.buildCodeFrameError(
      `memo-dom: cannot resolve effect callback '${argumentName}' — use an inline function or a local/module-level function declaration or const`,
    );
  }
  if (callback.async || callback.generator) {
    throw errorAt.buildCodeFrameError(
      'memo-dom: effect callback must be synchronous; start async work inside it and return a synchronous teardown',
    );
  }
  if (nodeHasJsx(callback.body)) {
    throw errorAt.buildCodeFrameError(
      'memo-dom: a JSX component cannot be used as an effect callback',
    );
  }
  return {
    expression: cloneNode(argument) as unknown as t.Expression,
    node: callback,
    importedReads: new Set(),
  };
}

function collectEffectReads(
  ctx: Ctx,
  compName: string,
  compPath: ComponentPath,
  root: BaseNode,
): Pick<EffectSite, 'moduleReads' | 'localReads' | 'localDerivationReads'> {
  const moduleReads = new Set<string>();
  const directLocalReads = new Set<string>();
  const bindings = new Map<Binding, { source: string; local: boolean }>();
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
    const binding = astBindingAt(ctx, compPath.node, name);
    if (binding !== undefined) {
      bindings.set(binding, { source: name, local: true });
    }
  }
  for (const name of derivedSources.keys()) {
    const binding = astBindingAt(ctx, compPath.node, name);
    if (binding !== undefined) {
      bindings.set(binding, { source: name, local: true });
    }
  }
  for (const name of ctx.state.keys()) {
    const binding = astBindingAt(ctx, compPath.node, name);
    if (binding?.scope.isProgramScope === true) {
      bindings.set(binding, { source: name, local: false });
    }
  }

  const noteIdentifier = (identifier: BaseNode): void => {
    const name = identifierName(identifier);
    if (name === null) return;
    const binding = astBindingAt(ctx, identifier, name);
    if (binding !== undefined && !binding.references.includes(
      identifier as unknown as Identifier,
    )) return;
    const origin = binding === undefined ? undefined : bindings.get(binding);
    if (origin === undefined) return;

    // Store members are path-keyed by the MemberExpression visitor below.
    const parent = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
    if (
      !origin.local &&
      ctx.state.get(origin.source) === 'store' &&
      parent?.type === 'MemberExpression' &&
      childNode(parent, 'object') === identifier
    ) {
      return;
    }

    if (origin.local) directLocalReads.add(origin.source);
    else moduleReads.add(origin.source);
  };

  const noteMember = (member: BaseNode): void => {
    const key = memberKey(member as unknown as t.MemberExpression);
    const rootName = memberRootName(member as unknown as t.MemberExpression);
    if (
      key === null ||
      rootName === null ||
      ctx.state.get(rootName) !== 'store' ||
      astBindingAt(ctx, member, rootName)?.scope.isProgramScope !== true
    ) {
      return;
    }
    moduleReads.add(key);
  };

  const noteCall = (call: BaseNode): void => {
    const callee = childNode(call, 'callee');
    const calleeName = identifierName(callee);
    if (
      callee === null ||
      calleeName === null ||
      astBindingAt(ctx, call, calleeName)?.scope.isProgramScope !== true ||
      (!ctx.helpers.has(calleeName) &&
        !ctx.importedFunctions.has(calleeName))
    ) {
      return;
    }
    const summary =
      ctx.importedFunctions.get(calleeName) ??
      summarizeHelper(ctx, calleeName);
    for (const read of summary.reads) moduleReads.add(read);
  };

  walkAst(root, {
    enter(node) {
      // Reads deferred into timers/promises/listeners are not dependencies of
      // the surrounding effect execution.
      if (node !== root && (
        node.type === 'ArrowFunctionExpression' ||
        node.type === 'FunctionExpression' ||
        node.type === 'FunctionDeclaration'
      )) return false;
      if (node.type === 'Identifier') noteIdentifier(node);
      if (node.type === 'MemberExpression') noteMember(node);
      if (node.type === 'CallExpression') noteCall(node);
      return undefined;
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
  root: BaseNode,
): Set<string> {
  const reads = new Set<string>();
  const noteIdentifier = (identifier: BaseNode): void => {
    const name = identifierName(identifier);
    if (
      name === null ||
      !ctx.state.has(name) ||
      astBindingAt(ctx, identifier, name)?.scope.isProgramScope !== true
    ) {
      return;
    }
    const binding = astBindingAt(ctx, identifier, name);
    if (binding !== undefined && !binding.references.includes(
      identifier as unknown as Identifier,
    )) return;
    const parent = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
    if (
      ctx.state.get(name) === 'store' &&
      parent?.type === 'MemberExpression' &&
      childNode(parent, 'object') === identifier
    ) {
      return;
    }
    reads.add(name);
  };

  const noteMember = (member: BaseNode): void => {
    const key = memberKey(member as unknown as t.MemberExpression);
    const rootName = memberRootName(member as unknown as t.MemberExpression);
    if (
      key !== null &&
      rootName !== null &&
      ctx.state.get(rootName) === 'store' &&
      astBindingAt(ctx, member, rootName)?.scope.isProgramScope === true
    ) {
      reads.add(key);
    }
  };
  const noteCall = (call: BaseNode): void => {
    const calleeName = identifierName(childNode(call, 'callee'));
    if (
      calleeName === null ||
      astBindingAt(ctx, call, calleeName)?.scope.isProgramScope !== true ||
      (!ctx.helpers.has(calleeName) &&
        !ctx.importedFunctions.has(calleeName))
    ) {
      return;
    }
    const summary =
      ctx.importedFunctions.get(calleeName) ??
      summarizeHelper(ctx, calleeName);
    for (const read of summary.reads) reads.add(read);
  };

  walkAst(root, {
    enter(node) {
      if (node !== root && (
        node.type === 'ArrowFunctionExpression' ||
        node.type === 'FunctionExpression' ||
        node.type === 'FunctionDeclaration'
      )) return false;
      if (node.type === 'Identifier') noteIdentifier(node);
      if (node.type === 'MemberExpression') noteMember(node);
      if (node.type === 'CallExpression') noteCall(node);
      return undefined;
    },
  });
  return reads;
}

interface EffectConditionPath {
  node: t.Expression;
  negated: boolean;
}

interface OwnedEffectCall {
  call: t.CallExpression;
  rootStatement: t.Statement;
  conditions: EffectConditionPath[];
}

function directEffectCall(
  ctx: Ctx,
  statement: BaseNode,
): t.CallExpression | null {
  if (statement.type !== 'ExpressionStatement') return null;
  const expression = childNode(statement, 'expression');
  return expression !== null && isIntrinsicEffect(ctx, expression)
    ? expression as unknown as t.CallExpression
    : null;
}

function containsOwnedEffect(ctx: Ctx, statement: BaseNode): boolean {
  if (directEffectCall(ctx, statement) !== null) return true;
  let found = false;
  walkAst(statement, {
    enter(node) {
      if (node !== statement && (
        node.type === 'ArrowFunctionExpression' ||
        node.type === 'FunctionExpression' ||
        node.type === 'FunctionDeclaration'
      )) return false;
      if (node.type === 'CallExpression' && isIntrinsicEffect(ctx, node)) {
        found = true;
        return false;
      }
      return undefined;
    },
  });
  return found;
}

function collectOwnedEffectCalls(
  ctx: Ctx,
  statement: BaseNode,
  rootStatement: t.Statement,
  conditions: EffectConditionPath[],
  output: OwnedEffectCall[],
  errorAt: DiagnosticPath,
): void {
  const direct = directEffectCall(ctx, statement);
  if (direct !== null) {
    output.push({
      call: direct,
      rootStatement,
      conditions: [...conditions],
    });
    return;
  }
  if (statement.type === 'EmptyStatement') return;
  if (statement.type === 'BlockStatement') {
    for (const child of childNodes(statement, 'body')) {
      if (child.type === 'EmptyStatement') continue;
      if (!containsOwnedEffect(ctx, child)) {
        throw errorAt.buildCodeFrameError(
          'memo-dom: a conditional effect branch may contain only effect() calls, nested if statements, or empty statements',
        );
      }
      collectOwnedEffectCalls(
        ctx,
        child,
        rootStatement,
        conditions,
        output,
        errorAt,
      );
    }
    return;
  }
  if (statement.type === 'IfStatement') {
    const test = childNode(statement, 'test') as t.Expression | null;
    const consequent = childNode(statement, 'consequent');
    if (test === null || consequent === null) return;
    collectOwnedEffectCalls(
      ctx,
      consequent,
      rootStatement,
      [...conditions, { node: test, negated: false }],
      output,
      errorAt,
    );
    const alternate = childNode(statement, 'alternate');
    if (alternate !== null) {
      collectOwnedEffectCalls(
        ctx,
        alternate,
        rootStatement,
        [...conditions, { node: test, negated: true }],
        output,
        errorAt,
      );
    }
    return;
  }
  throw errorAt.buildCodeFrameError(
    'memo-dom: conditional effect() calls must be controlled by top-level if statements',
  );
}

function discoverOwnedEffectCalls(
  ctx: Ctx,
  statements: BaseNode[],
  errorAt: DiagnosticPath,
): OwnedEffectCall[] {
  const output: OwnedEffectCall[] = [];
  for (const statement of statements) {
    const direct = directEffectCall(ctx, statement);
    if (direct !== null) {
      output.push({
        call: direct,
        rootStatement: statement as unknown as t.Statement,
        conditions: [],
      });
      continue;
    }
    if (statement.type !== 'IfStatement' || !containsOwnedEffect(ctx, statement)) {
      continue;
    }
    collectOwnedEffectCalls(
      ctx,
      statement,
      statement as unknown as t.Statement,
      [],
      output,
      errorAt,
    );
  }
  return output;
}

function combinedCondition(
  conditions: EffectConditionPath[],
): t.Expression | null {
  if (conditions.length === 0) return null;
  const expressions = conditions.map(({ node, negated }) =>
    negated
      ? astFactory.unaryExpression('!', cloneNode(node) as unknown as t.Expression)
      : cloneNode(node) as unknown as t.Expression,
  );
  return expressions.reduce((left, right) =>
    astFactory.logicalExpression('&&', left, right),
  );
}

function scanModuleEffects(
  ctx: Ctx,
  programPath: ProgramPath,
): void {
  const sites: ModuleEffectSite[] = [];
  const occurrences = discoverOwnedEffectCalls(
    ctx,
    childNodes(programPath.node, 'body'),
    programPath,
  );
  for (const occurrence of occurrences) {
    const resolved = resolveEffectCallback(ctx, occurrence.call, programPath);
    const moduleReads =
      resolved.node === null
        ? resolved.importedReads
        : collectModuleEffectReads(ctx, resolved.node);
    const conditionModuleReads = new Set<string>();
    for (const condition of occurrence.conditions) {
      for (const read of collectModuleEffectReads(ctx, condition.node)) {
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
  programPath: ProgramPath,
): void {
  scanModuleEffects(ctx, programPath);
  for (const [compName, compPath] of ctx.compPaths) {
    const sites: EffectSite[] = [];
    const accepted = new Set<t.CallExpression>();
    const occurrences = discoverOwnedEffectCalls(
      ctx,
      childNodes(compPath.node.body, 'body'),
      compPath,
    );

    for (const occurrence of occurrences) {
      const resolved = resolveEffectCallback(ctx, occurrence.call, compPath);
      const reads =
        resolved.node === null
          ? {
              moduleReads: resolved.importedReads,
              localReads: new Set<string>(),
              localDerivationReads: new Set<string>(),
            }
          : collectEffectReads(
              ctx,
              compName,
              compPath,
              resolved.node,
            );
      const conditionModuleReads = new Set<string>();
      const conditionLocalReads = new Set<string>();
      const conditionLocalDerivationReads = new Set<string>();
      for (const condition of occurrence.conditions) {
        const conditionReads = collectEffectReads(
          ctx,
          compName,
          compPath,
          condition.node,
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
      accepted.add(occurrence.call);
    }

    walkAst(compPath.node.body as unknown as BaseNode, {
      enter(node) {
        if (node !== compPath.node.body && (
          node.type === 'ArrowFunctionExpression' ||
          node.type === 'FunctionExpression' ||
          node.type === 'FunctionDeclaration'
        )) return false;
        if (
          node.type !== 'CallExpression' ||
          !isIntrinsicEffect(ctx, node) ||
          accepted.has(node as unknown as t.CallExpression)
        ) return undefined;
        throw compPath.buildCodeFrameError(
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
    astFactory.logicalExpression('||', left, right),
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
  const current = (): t.Identifier => astFactory.identifier(reasonVar);
  const numberMatch = or(
    reasons.map((reason) =>
      astFactory.binaryExpression('===', current(), astFactory.numericLiteral(reason)),
    ),
  );
  const setMatch = or(
    reasons.map((reason) =>
      astFactory.callExpression(
        astFactory.memberExpression(current(), astFactory.identifier('has')),
        [astFactory.numericLiteral(reason)],
      ),
    ),
  );
  return astFactory.logicalExpression(
    '||',
    astFactory.binaryExpression('===', current(), astFactory.nullLiteral()),
    astFactory.conditionalExpression(
      astFactory.binaryExpression(
        '===',
        astFactory.unaryExpression('typeof', current()),
        astFactory.stringLiteral('number'),
      ),
      numberMatch,
      setMatch,
    ),
  );
}

/** A pull-only frame is not evidence that any effect dependency was written. */
function volatilePullOnly(reasonVar: string): t.Expression {
  const current = (): t.Identifier => astFactory.identifier(reasonVar);
  return astFactory.logicalExpression(
    '||',
    astFactory.binaryExpression('===', current(), astFactory.unaryExpression('-', astFactory.numericLiteral(1))),
    astFactory.logicalExpression(
      '&&',
      astFactory.logicalExpression(
        '&&',
        astFactory.binaryExpression('!==', current(), astFactory.nullLiteral()),
        astFactory.binaryExpression(
          '!==',
          astFactory.unaryExpression('typeof', current()),
          astFactory.stringLiteral('number'),
        ),
      ),
      astFactory.logicalExpression(
        '&&',
        astFactory.binaryExpression(
          '===',
          astFactory.memberExpression(current(), astFactory.identifier('size')),
          astFactory.numericLiteral(1),
        ),
        astFactory.callExpression(
          astFactory.memberExpression(current(), astFactory.identifier('has')),
          [astFactory.unaryExpression('-', astFactory.numericLiteral(1))],
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
      let mark: t.Statement = astFactory.expressionStatement(
        astFactory.callExpression(md(ctx, 'markDirty'), [
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
            astFactory.variableDeclaration('let', [
              astFactory.variableDeclarator(
                astFactory.identifier(slotName),
                astFactory.identifier(derivName),
              ),
            ]),
          );
          checks.push(
            astFactory.binaryExpression(
              '!==',
              astFactory.identifier(slotName),
              astFactory.identifier(derivName),
            ),
          );
          updates.push(
            astFactory.expressionStatement(
              astFactory.assignmentExpression(
                '=',
                astFactory.identifier(slotName),
                astFactory.identifier(derivName),
              ),
            ),
          );
        }

        const condition =
          checks.length === 1
            ? checks[0]!
            : checks.reduce((left, right) =>
                astFactory.logicalExpression('||', left, right),
              );

        mark = astFactory.ifStatement(
          condition,
          astFactory.blockStatement([...updates, mark]),
        );
      }

      if (reasonVar === null) return mark;
      const condition = localEffectCondition(
        ctx,
        component,
        reasonVar,
        localReads,
      );
      const routed = condition === null ? mark : astFactory.ifStatement(condition, mark);
      return astFactory.ifStatement(
        astFactory.unaryExpression('!', volatilePullOnly(reasonVar)),
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
  return astFactory.blockStatement(statements);
}

/** Runtime registrations emitted after the owner's DOM creation statements. */
export function buildEffectRegistrations(
  ctx: Ctx,
  factoryId: string,
  sites: EffectSite[],
): t.Statement[] {
  return sites.map((site) =>
    astFactory.expressionStatement(
      astFactory.callExpression(
        md(
          ctx,
          site.condition === null
            ? 'registerEffect'
            : 'registerConditionalEffect',
        ),
        [
          effectId(factoryId, site.index),
          astFactory.identifier(factoryId),
          ...(site.condition === null
            ? []
            : [
                astFactory.arrowFunctionExpression(
                  [],
                  cloneEstreeNode(site.condition, true),
                ),
              ]),
          cloneEstreeNode(site.callback, true),
        ],
      ),
    ),
  );
}

function importMetaHot(): t.MemberExpression {
  return astFactory.memberExpression(
    astFactory.metaProperty(astFactory.identifier('import'), astFactory.identifier('meta')),
    astFactory.identifier('hot'),
  );
}

/** Lower direct module effects to stable singleton registrations. */
export function rewriteModuleEffects(
  ctx: Ctx,
  programPath: ProgramPath,
): void {
  if (ctx.moduleEffects.length === 0) return;
  const grouped = new Map<t.Statement, ModuleEffectSite[]>();
  for (const site of ctx.moduleEffects) {
    const sites = grouped.get(site.statement) ?? [];
    sites.push(site);
    grouped.set(site.statement, sites);
  }
  for (const [statement, sites] of grouped) {
    const body = fields(programPath.node).body as t.Statement[];
    const index = body.indexOf(statement);
    if (index === -1) continue;
    const replacements: t.Statement[] = [];
    for (const site of sites) {
      replacements.push(
        astFactory.expressionStatement(
          astFactory.callExpression(
            md(
              ctx,
              site.condition === null
                ? 'registerEffect'
                : 'registerConditionalEffect',
            ),
            [
              astFactory.stringLiteral(site.entityId),
              astFactory.nullLiteral(),
              ...(site.condition === null
                ? []
                : [
                    astFactory.arrowFunctionExpression(
                      [],
                      cloneEstreeNode(site.condition, true),
                    ),
                  ]),
              cloneEstreeNode(site.callback, true),
            ],
          ),
        ),
        astFactory.ifStatement(
          importMetaHot(),
          astFactory.expressionStatement(
            astFactory.callExpression(
              astFactory.memberExpression(importMetaHot(), astFactory.identifier('dispose')),
              [
                astFactory.arrowFunctionExpression(
                  [],
                  astFactory.callExpression(md(ctx, 'unregisterSubtree'), [
                    astFactory.stringLiteral(site.entityId),
                  ]),
                ),
              ],
            ),
          ),
        ),
      );
    }
    body.splice(index, 1, ...replacements);
  }
}

/** Reject effect syntax that was not consumed by component emission. */
export function rejectUnownedEffects(
  ctx: Ctx,
  programPath: ProgramPath,
): void {
  refreshAstAnalysis(ctx, programPath.node);
  walkAst(programPath.node as unknown as BaseNode, {
    enter(node) {
      if (node.type === 'CallExpression' && isIntrinsicEffect(ctx, node)) {
        throw programPath.buildCodeFrameError(
          'memo-dom: effect() must be a direct top-level statement or be controlled by a top-level effect-only if branch in a component or module',
        );
      }
    },
  });
}
