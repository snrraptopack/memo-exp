import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  childNode,
  FUNCTION_NODE_TYPES as FUNCTION_NODES,
  identifierName,
  nodeFields as fields,
  walkAst,
  type BaseNode,
  type Binding,
} from '../ast';
import {
  astBindingAt,
  variableDeclaratorFor,
  type Ctx,
} from '../context';
import type { ControlFlowDerivation } from '../components/props';
import { summarizeHelper } from '../helper-summaries';

const IMPURE_REPLAY_NODES = new Set([
  'AssignmentExpression',
  'AwaitExpression',
  'UpdateExpression',
  'YieldExpression',
]);

/**
 * Whether an expression can be re-executed on every derivation replay.
 * Calls (including `new`, tagged templates, and optional calls) replay like
 * any other expression — there is no method whitelist. Writes embedded in a
 * test (assignment, update, delete) are barriers only because their targets
 * are not tracked bindings of the derivation; await/yield cannot run inside
 * the synchronous replay closure.
 */
function replayExpressionIsPure(expression: t.Expression): boolean {
  let pure = true;
  walkAst<BaseNode>(expression as unknown as BaseNode, {
    enter(node) {
      if (
        IMPURE_REPLAY_NODES.has(node.type) ||
        (node.type === 'UnaryExpression' &&
          fields(node).operator === 'delete')
      ) {
        pure = false;
        return false;
      }
    },
  });
  return pure;
}

function replayAssignmentTarget(statement: t.Statement): string | null {
  if (
    !astFactory.isExpressionStatement(statement) ||
    !astFactory.isAssignmentExpression(statement.expression, { operator: '=' }) ||
    !astFactory.isIdentifier(statement.expression.left) ||
    !replayExpressionIsPure(statement.expression.right)
  ) {
    return null;
  }
  return statement.expression.left.name;
}

function sameBindings(left: Set<string>, right: Set<string>): boolean {
  return (
    left.size === right.size &&
    [...left].every((binding) => right.has(binding))
  );
}

interface ReplayControlShape {
  bindings: Set<string>;
  /** Bindings that are not assigned on at least one control-flow path. */
  partial: Set<string>;
}

function replayBindingsForStatement(
  statement: t.Statement,
  ignoreTestPurity = false,
): ReplayControlShape | null {
  if (astFactory.isExpressionStatement(statement)) {
    const target = replayAssignmentTarget(statement);
    return target === null
      ? null
      : { bindings: new Set([target]), partial: new Set() };
  }
  if (astFactory.isBlockStatement(statement)) {
    const bindings = new Set<string>();
    const partial = new Set<string>();
    for (const child of statement.body) {
      const childShape = replayBindingsForStatement(child, ignoreTestPurity);
      if (childShape === null) return null;
      for (const binding of childShape.bindings) {
        if (bindings.has(binding)) return null;
        bindings.add(binding);
      }
      for (const binding of childShape.partial) partial.add(binding);
    }
    return bindings.size === 0 ? null : { bindings, partial };
  }
  if (astFactory.isIfStatement(statement)) {
    if (
      !ignoreTestPurity &&
      !replayExpressionIsPure(statement.test)
    ) {
      return null;
    }
    const consequent = replayBindingsForStatement(
      statement.consequent,
      ignoreTestPurity,
    );
    if (consequent === null) return null;
    if (statement.alternate == null) {
      return {
        bindings: consequent.bindings,
        partial: new Set([
          ...consequent.bindings,
          ...consequent.partial,
        ]),
      };
    }
    const alternate = replayBindingsForStatement(
      statement.alternate,
      ignoreTestPurity,
    );
    if (
      alternate === null ||
      !sameBindings(consequent.bindings, alternate.bindings)
    ) {
      return null;
    }
    return {
      bindings: consequent.bindings,
      partial: new Set([...consequent.partial, ...alternate.partial]),
    };
  }
  return null;
}

function replayBindingsForSwitch(
  statement: t.SwitchStatement,
  ignoreTestPurity = false,
): ReplayControlShape | null {
  if (
    !ignoreTestPurity &&
    !replayExpressionIsPure(statement.discriminant)
  ) {
    return null;
  }
  let common: ReplayControlShape | null = null;
  for (const switchCase of statement.cases) {
    if (
      switchCase.test != null &&
      !ignoreTestPurity &&
      !replayExpressionIsPure(switchCase.test)
    ) {
      return null;
    }
    const body = [...switchCase.consequent];
    if (body.at(-1) && astFactory.isBreakStatement(body.at(-1)!)) body.pop();
    if (body.some((child) => astFactory.isBreakStatement(child))) return null;
    const shape = replayBindingsForStatement(
      astFactory.blockStatement(body),
      ignoreTestPurity,
    );
    if (shape === null) return null;
    if (common === null) {
      common = shape;
    } else {
      if (!sameBindings(common.bindings, shape.bindings)) return null;
      for (const binding of shape.partial) common.partial.add(binding);
    }
  }
  if (
    common !== null &&
    !statement.cases.some((switchCase) => switchCase.test === null)
  ) {
    for (const binding of common.bindings) common.partial.add(binding);
  }
  return common;
}

function nodeBelongsTo(
  ctx: Ctx,
  node: BaseNode,
  statement: t.Statement,
): boolean {
  let current: BaseNode | null = node;
  while (current !== null) {
    if (current === statement) return true;
    current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  }
  return false;
}

function identifierIsRead(ctx: Ctx, identifier: BaseNode): boolean {
  const parent = ctx.astAnalysis?.parentByNode.get(identifier) ?? null;
  const key = ctx.astAnalysis?.keyByNode.get(identifier);
  if (parent?.type === 'AssignmentExpression' && key === 'left') {
    return fields(parent).operator !== '=';
  }
  if (
    (parent?.type === 'UpdateExpression' && key === 'argument') ||
    ((parent?.type === 'ForInStatement' || parent?.type === 'ForOfStatement') &&
      key === 'left')
  ) {
    return parent.type === 'UpdateExpression';
  }
  return true;
}

interface ReactiveReadFlags {
  /** A call in the statement performs writes or cannot be summarized. */
  unsafeCall: boolean;
}

/** Resolve a callee binding to its local function node, if it has one. */
function localFunctionFor(
  ctx: Ctx,
  binding: Binding,
):
  | t.FunctionDeclaration
  | t.ArrowFunctionExpression
  | t.FunctionExpression
  | null {
  if (binding.declarationNode?.type === 'FunctionDeclaration') {
    return binding.declarationNode as t.FunctionDeclaration;
  }
  const declarator = variableDeclaratorFor(ctx, binding);
  if (declarator === null) return null;
  let init = childNode(
    declarator as unknown as BaseNode,
    'init',
  ) as t.Node | null;
  while (init !== null && astFactory.isTransparentExpression(init)) {
    init = childNode(
      init as unknown as BaseNode,
      'expression',
    ) as t.Node | null;
  }
  if (
    init !== null &&
    (astFactory.isArrowFunctionExpression(init) ||
      astFactory.isFunctionExpression(init))
  ) {
    return init;
  }
  return null;
}

/**
 * A replayed call re-executes its body on every derivation update, so a local
 * closure that writes reactive state would silently mutate on replay. Flag
 * the write so the caller can diagnose instead of replaying.
 */
function flagLocalWrites(
  ctx: Ctx,
  fn: t.Node,
  reactiveBindings: ReadonlyMap<Binding, string>,
  flags: ReactiveReadFlags,
): void {
  const body = childNode(fn as unknown as BaseNode, 'body') ?? fn;
  walkAst<BaseNode>(body as unknown as BaseNode, {
    enter(node) {
      if (node !== body && FUNCTION_NODES.has(node.type)) return false;
      const target =
        node.type === 'AssignmentExpression'
          ? childNode(node, 'left')
          : node.type === 'UpdateExpression'
            ? childNode(node, 'argument')
            : node.type === 'UnaryExpression' &&
                fields(node).operator === 'delete'
              ? childNode(node, 'argument')
              : null;
      if (target === null || target === undefined) return;
      let base = target;
      while (
        base.type === 'MemberExpression' ||
        base.type === 'OptionalMemberExpression'
      ) {
        const object = childNode(base, 'object');
        if (object === null) return;
        base = object;
      }
      const name = identifierName(base);
      if (name === null) return;
      const targetBinding = astBindingAt(ctx, target, name);
      if (targetBinding !== undefined && reactiveBindings.has(targetBinding)) {
        flags.unsafeCall = true;
      }
    },
  });
}

function noteReactiveReads(
  ctx: Ctx,
  root: BaseNode,
  reactiveBindings: ReadonlyMap<Binding, string>,
  reads: Set<string>,
  flags?: ReactiveReadFlags,
  visited: Set<t.Node> = new Set(),
): void {
  walkAst<BaseNode>(root, {
    enter(node) {
      if (node !== root && FUNCTION_NODES.has(node.type)) return false;
      if (
        node.type === 'CallExpression' ||
        node.type === 'OptionalCallExpression'
      ) {
        // Calls re-execute on every replay. When the callee is a summarized
        // local helper or linked import, fold its reads so the derivation
        // re-runs when the call's actual dependencies change — no method
        // whitelist; unknown callees simply contribute their argument reads.
        const callee = childNode(node, 'callee');
        const calleeName =
          callee === null ? null : identifierName(callee);
        if (calleeName === null) return;
        const binding = astBindingAt(ctx, callee!, calleeName);
        if (binding === undefined) return;
        if (binding.scope.isProgramScope === true) {
          const summary =
            ctx.importedFunctions.get(calleeName) ??
            (ctx.helpers.has(calleeName)
              ? summarizeHelper(ctx, calleeName)
              : undefined);
          if (summary === undefined) return;
          for (const read of summary.reads) reads.add(read);
          if (
            flags !== undefined &&
            (summary.writes.size > 0 ||
              summary.boundedWrites.size > 0 ||
              summary.unbounded)
          ) {
            flags.unsafeCall = true;
          }
          return;
        }
        // A component-local function closes over reactive state without a
        // summary. Fold its body's free reads — its params resolve to local
        // bindings and are ignored — and flag writes it performs, since the
        // call re-executes on every replay.
        const fn = localFunctionFor(ctx, binding);
        if (fn === null || visited.has(fn)) return;
        visited.add(fn);
        if (flags !== undefined) {
          flagLocalWrites(ctx, fn, reactiveBindings, flags);
        }
        noteReactiveReads(
          ctx,
          childNode(fn as unknown as BaseNode, 'body') ?? fn,
          reactiveBindings,
          reads,
          flags,
          visited,
        );
        return;
      }
      if (node.type !== 'Identifier' || !identifierIsRead(ctx, node)) return;
      const name = fields(node).name;
      if (typeof name !== 'string') return;
      const binding = astBindingAt(ctx, node, name);
      const source =
        binding === undefined ? undefined : reactiveBindings.get(binding);
      if (source !== undefined) reads.add(source);
    },
  });
}

/**
 * Classify pure top-level if/switch calculations for reactive replay.
 * Side-effectful control flow remains one-time authored setup.
 */
export function scanInstanceControlFlow(ctx: Ctx): void {
  for (const [componentName, componentPath] of ctx.compPaths) {
    const reactiveBindings = new Map<Binding, string>();
    for (const name of ctx.componentProps.get(componentName)?.bindings ?? []) {
      const binding = astBindingAt(
        ctx,
        componentPath.node as unknown as BaseNode,
        name,
      );
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.instanceState.get(componentName) ?? []) {
      const binding = astBindingAt(
        ctx,
        componentPath.node as unknown as BaseNode,
        name,
      );
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.instanceDerivedBindings.get(componentName) ?? []) {
      const binding = astBindingAt(
        ctx,
        componentPath.node as unknown as BaseNode,
        name,
      );
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.state.keys()) {
      const binding = astBindingAt(
        ctx,
        componentPath.node as unknown as BaseNode,
        name,
      );
      if (binding?.scope.isProgramScope === true) {
        reactiveBindings.set(binding, name);
      }
    }

    const controls: ControlFlowDerivation[] = [];
    const derivedBindings =
      ctx.instanceDerivedBindings.get(componentName) ?? new Set<string>();
    for (const statement of componentPath.node.body.body) {
      if (!astFactory.isIfStatement(statement) && !astFactory.isSwitchStatement(statement)) {
        continue;
      }
      const shape = astFactory.isIfStatement(statement)
        ? replayBindingsForStatement(statement)
        : replayBindingsForSwitch(statement);
      if (shape === null) {
        // If only test/discriminant purity blocked an otherwise well-formed
        // derivation and the statement reads reactive state, it would
        // silently remain one-time setup — a stale binding with no signal.
        const relaxed = astFactory.isIfStatement(statement)
          ? replayBindingsForStatement(statement, true)
          : replayBindingsForSwitch(statement, true);
        if (relaxed === null) continue;
        const silentReads = new Set<string>();
        noteReactiveReads(
          ctx,
          statement as unknown as BaseNode,
          reactiveBindings,
          silentReads,
        );
        if (silentReads.size === 0) continue;
        throw componentPath.buildCodeFrameError(
          `memo-dom: control flow in component '${componentName}' reads reactive state but its test is not replayable (it contains an assignment, update, delete, await, or yield); hoist the value into a const first`,
        );
      }

      let eligible = true;
      const resets: ControlFlowDerivation['resets'] = [];
      const resetExpressions: t.Expression[] = [];
      for (const name of shape.bindings) {
        const binding = astBindingAt(
          ctx,
          statement as unknown as BaseNode,
          name,
        );
        const declaration =
          binding === undefined ? null : variableDeclaratorFor(ctx, binding);
        const declarationStatement = binding?.declarationNode;
        const declarationKind =
          declarationStatement?.type === 'VariableDeclaration'
            ? fields(declarationStatement).kind
            : null;
        if (
          binding === undefined ||
          declaration === null ||
          (declarationKind !== 'let' && declarationKind !== 'var') ||
          binding.constantViolations.some(
            (violation) => !nodeBelongsTo(ctx, violation, statement),
          )
        ) {
          eligible = false;
          break;
        }
        if (shape.partial.has(name)) {
          const init = childNode(declaration, 'init');
          if (
            init === null ||
            !replayExpressionIsPure(init as unknown as t.Expression)
          ) {
            eligible = false;
            break;
          }
          const expression = init as unknown as t.Expression;
          resets.push({ binding: name, source: expression });
          resetExpressions.push(expression);
        }
      }
      if (!eligible) continue;

      const reads = new Set<string>();
      const readFlags: ReactiveReadFlags = { unsafeCall: false };
      noteReactiveReads(
        ctx,
        statement as unknown as BaseNode,
        reactiveBindings,
        reads,
        readFlags,
      );

      for (const resetExpression of resetExpressions) {
        noteReactiveReads(
          ctx,
          resetExpression as unknown as BaseNode,
          reactiveBindings,
          reads,
          readFlags,
        );
      }
      if (reads.size === 0) continue;
      if (readFlags.unsafeCall) {
        throw componentPath.buildCodeFrameError(
          `memo-dom: control flow in component '${componentName}' replays a call that writes state or cannot be summarized; hoist the call result into a const or move the write into a handler`,
        );
      }
      for (const name of shape.bindings) {
        if (reads.has(name)) {
          throw componentPath.buildCodeFrameError(
            `memo-dom: reactive control-flow derivation '${name}' reads its own previous value`,
          );
        }
      }

      controls.push({
        statement,
        bindings: [...shape.bindings].sort(),
        resets,
        sources: [...reads].sort(),
      });
      for (const name of shape.bindings) {
        derivedBindings.add(name);
        const binding = astBindingAt(
          ctx,
          statement as unknown as BaseNode,
          name,
        );
        if (binding) reactiveBindings.set(binding, name);
        ctx.instanceState.get(componentName)?.delete(name);
      }
    }
    if (controls.length > 0) {
      ctx.instanceControlFlow.set(componentName, controls);
      ctx.instanceDerivedBindings.set(componentName, derivedBindings);
    }
  }
}

/** Resolve transitive sources and allocate selective invalidation reasons. */
export function finalizeInstancePreludes(ctx: Ctx): void {
  for (const [componentName] of ctx.compPaths) {
    const locals = ctx.instanceDerivations.get(componentName) ?? [];
    const controls = ctx.instanceControlFlow.get(componentName) ?? [];
    if (locals.length === 0 && controls.length === 0) continue;

    const graph = new Map<string, Set<string>>();
    for (const derivation of locals) {
      if (derivation.stableTarget === true) continue;
      for (const binding of derivation.bindings) {
        graph.set(binding, new Set(derivation.sources));
      }
    }
    for (const control of controls) {
      for (const binding of control.bindings) {
        graph.set(binding, new Set(control.sources));
      }
    }
    const rootsOf = (
      source: string,
      visiting = new Set<string>(),
    ): Set<string> => {
      const upstream = graph.get(source);
      if (upstream === undefined) return new Set([source]);
      if (visiting.has(source)) return new Set([source]);
      const next = new Set(visiting).add(source);
      const roots = new Set<string>();
      for (const item of upstream) {
        for (const root of rootsOf(item, next)) roots.add(root);
      }
      return roots;
    };
    for (const derivation of locals) {
      derivation.sources = [
        ...new Set(
          derivation.sources.flatMap((source) => [...rootsOf(source)]),
        ),
      ].sort();
    }
    for (const control of controls) {
      control.sources = [
        ...new Set(
          control.sources.flatMap((source) => [...rootsOf(source)]),
        ),
      ].sort();
    }

    const exactSources = new Set<string>([
      ...(ctx.instanceState.get(componentName) ?? []),
      ...(ctx.componentProps.get(componentName)?.bindings ?? []),
    ]);
    const work = [...locals, ...controls];
    const selective = [...exactSources].some((source) =>
      work.some((derivation) => !derivation.sources.includes(source)),
    );
    ctx.selectiveDerivationComponents.delete(componentName);
    ctx.instanceReasonIds.delete(componentName);
    if (!selective) continue;
    const reasonSources = new Set<string>([
      ...exactSources,
      ...work.flatMap((derivation) => derivation.sources),
    ]);
    ctx.instanceReasonIds.set(
      componentName,
      new Map(
        [...reasonSources]
          .sort()
          .map((source, index) => [source, index]),
      ),
    );
    ctx.selectiveDerivationComponents.add(componentName);
  }
}
