import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { Ctx } from '../context';
import type { ControlFlowDerivation } from '../components/props';

type ReplayControlPath = NodePath<t.IfStatement | t.SwitchStatement>;

function replayExpressionIsPure(expression: t.Expression): boolean {
  let pure = true;
  t.traverseFast(expression, (node) => {
    if (
      t.isAssignmentExpression(node) ||
      t.isUpdateExpression(node) ||
      t.isAwaitExpression(node) ||
      t.isYieldExpression(node) ||
      t.isNewExpression(node) ||
      t.isTaggedTemplateExpression(node) ||
      t.isFunction(node)
    ) {
      pure = false;
      return;
    }
    if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) {
      const callee = node.callee;
      pure =
        pure &&
        t.isMemberExpression(callee) &&
        !callee.computed &&
        t.isIdentifier(callee.object, { name: 'Math' }) &&
        t.isIdentifier(callee.property);
    }
  });
  return pure;
}

function replayAssignmentTarget(statement: t.Statement): string | null {
  if (
    !t.isExpressionStatement(statement) ||
    !t.isAssignmentExpression(statement.expression, { operator: '=' }) ||
    !t.isIdentifier(statement.expression.left) ||
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
  if (t.isExpressionStatement(statement)) {
    const target = replayAssignmentTarget(statement);
    return target === null
      ? null
      : { bindings: new Set([target]), partial: new Set() };
  }
  if (t.isBlockStatement(statement)) {
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
  if (t.isIfStatement(statement)) {
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
    if (body.at(-1) && t.isBreakStatement(body.at(-1)!)) body.pop();
    if (body.some((child) => t.isBreakStatement(child))) return null;
    const shape = replayBindingsForStatement(t.blockStatement(body));
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

function violationBelongsTo(
  violation: NodePath,
  statement: t.Statement,
): boolean {
  return (
    violation.node === statement ||
    violation.findParent((parent) => parent.node === statement) !== null
  );
}

/**
 * Classify pure top-level if/switch calculations for reactive replay.
 * Side-effectful control flow remains one-time authored setup.
 */
export function scanInstanceControlFlow(ctx: Ctx): void {
  for (const [componentName, componentPath] of ctx.compPaths) {
    const reactiveBindings = new Map<unknown, string>();
    for (const name of ctx.componentProps.get(componentName)?.bindings ?? []) {
      const binding = componentPath.scope.getBinding(name);
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.instanceState.get(componentName) ?? []) {
      const binding = componentPath.scope.getBinding(name);
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.instanceDerivedBindings.get(componentName) ?? []) {
      const binding = componentPath.scope.getBinding(name);
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.state.keys()) {
      const binding = componentPath.scope.getBinding(name);
      if (binding?.scope.path.isProgram()) {
        reactiveBindings.set(binding, name);
      }
    }

    const controls: ControlFlowDerivation[] = [];
    const derivedBindings =
      ctx.instanceDerivedBindings.get(componentName) ?? new Set<string>();
    for (const statementPath of componentPath.get('body').get('body')) {
      if (
        !statementPath.isIfStatement() &&
        !statementPath.isSwitchStatement()
      ) {
        continue;
      }
      const path = statementPath as ReplayControlPath;
      const shape = path.isIfStatement()
        ? replayBindingsForStatement(path.node)
        : replayBindingsForSwitch(path.node);
      if (shape === null) continue;

      let eligible = true;
      const resets: ControlFlowDerivation['resets'] = [];
      const resetPaths: NodePath<t.Expression>[] = [];
      for (const name of shape.bindings) {
        const binding = componentPath.scope.getBinding(name);
        const declaration = binding?.path;
        const declarationStatement = declaration?.parentPath;
        if (
          binding === undefined ||
          !declaration?.isVariableDeclarator() ||
          !declarationStatement?.isVariableDeclaration() ||
          (declarationStatement.node.kind !== 'let' &&
            declarationStatement.node.kind !== 'var') ||
          binding.constantViolations.some(
            (violation) => !violationBelongsTo(violation, path.node),
          )
        ) {
          eligible = false;
          break;
        }
        if (shape.partial.has(name)) {
          const initPath = declaration.get('init');
          if (
            !initPath.isExpression() ||
            !replayExpressionIsPure(initPath.node)
          ) {
            eligible = false;
            break;
          }
          resets.push({ binding: name, source: initPath.node });
          resetPaths.push(initPath);
        }
      }
      if (!eligible) continue;

      const reads = new Set<string>();
      const noteIdentifier = (identifierPath: NodePath<t.Identifier>) => {
        const binding = identifierPath.scope.getBinding(
          identifierPath.node.name,
        );
        const source =
          binding === undefined ? undefined : reactiveBindings.get(binding);
        if (source !== undefined) reads.add(source);
      };
      const visitor = {
        Function(functionPath) {
          functionPath.skip();
        },
        ReferencedIdentifier(identifierPath) {
          if (identifierPath.isIdentifier()) noteIdentifier(identifierPath);
        },
      } satisfies Parameters<NodePath['traverse']>[0];
      path.traverse(visitor);
      for (const resetPath of resetPaths) {
        if (resetPath.isReferencedIdentifier()) {
          noteIdentifier(resetPath);
        }
        resetPath.traverse(visitor);
      }
      if (reads.size === 0) continue;
      for (const name of shape.bindings) {
        if (reads.has(name)) {
          throw path.buildCodeFrameError(
            `memo-dom: reactive control-flow derivation '${name}' reads its own previous value`,
          );
        }
      }

      controls.push({
        statement: path.node,
        bindings: [...shape.bindings].sort(),
        resets,
        sources: [...reads].sort(),
      });
      for (const name of shape.bindings) {
        derivedBindings.add(name);
        const binding = componentPath.scope.getBinding(name);
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
