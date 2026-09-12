import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  childNode,
  FUNCTION_NODE_TYPES as FUNCTION_NODES,
  nodeFields as fields,
  walkAst,
  type BaseNode,
  type Binding,
} from '../ast';
import { astBindingAt, type Ctx } from '../context';
import type { ControlFlowDerivation } from '../components/props';

const IMPURE_REPLAY_NODES = new Set([
  ...FUNCTION_NODES,
  'AssignmentExpression',
  'AwaitExpression',
  'NewExpression',
  'TaggedTemplateExpression',
  'UpdateExpression',
  'YieldExpression',
]);

function replayExpressionIsPure(expression: t.Expression): boolean {
  let pure = true;
  walkAst<BaseNode>(expression as unknown as BaseNode, {
    enter(node) {
      if (IMPURE_REPLAY_NODES.has(node.type)) {
        pure = false;
        return false;
      }
      if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') {
        return;
      }
      const callee = childNode(node, 'callee');
      const object = callee === null ? null : childNode(callee, 'object');
      const property = callee === null ? null : childNode(callee, 'property');
      pure =
        pure &&
        callee?.type === 'MemberExpression' &&
        fields(callee).computed === false &&
        object?.type === 'Identifier' &&
        fields(object).name === 'Math' &&
        property?.type === 'Identifier';
      return pure ? undefined : false;
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
      const childShape = replayBindingsForStatement(child);
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
    if (!replayExpressionIsPure(statement.test)) return null;
    const consequent = replayBindingsForStatement(statement.consequent);
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
    const alternate = replayBindingsForStatement(statement.alternate);
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
): ReplayControlShape | null {
  if (!replayExpressionIsPure(statement.discriminant)) return null;
  let common: ReplayControlShape | null = null;
  for (const switchCase of statement.cases) {
    if (
      switchCase.test != null &&
      !replayExpressionIsPure(switchCase.test)
    ) {
      return null;
    }
    const body = [...switchCase.consequent];
    if (body.at(-1) && astFactory.isBreakStatement(body.at(-1)!)) body.pop();
    if (body.some((child) => astFactory.isBreakStatement(child))) return null;
    const shape = replayBindingsForStatement(astFactory.blockStatement(body));
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

function variableDeclaratorFor(ctx: Ctx, binding: Binding): BaseNode | null {
  let current: BaseNode | null = binding.identifier;
  while (current !== null && current !== binding.declarationNode) {
    if (current.type === 'VariableDeclarator') return current;
    current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  }
  return null;
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

function noteReactiveReads(
  ctx: Ctx,
  root: BaseNode,
  reactiveBindings: ReadonlyMap<Binding, string>,
  reads: Set<string>,
): void {
  walkAst<BaseNode>(root, {
    enter(node) {
      if (node !== root && FUNCTION_NODES.has(node.type)) return false;
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
      if (shape === null) continue;

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
      noteReactiveReads(
        ctx,
        statement as unknown as BaseNode,
        reactiveBindings,
        reads,
      );
      for (const resetExpression of resetExpressions) {
        noteReactiveReads(
          ctx,
          resetExpression as unknown as BaseNode,
          reactiveBindings,
          reads,
        );
      }
      if (reads.size === 0) continue;
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
