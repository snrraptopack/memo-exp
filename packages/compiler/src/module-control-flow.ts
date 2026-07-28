/**
 * Pure exhaustive module-level if/switch derivations.
 */
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  registerState,
  type ComputedAnalysis,
  type Ctx,
} from './context';

interface ReplayShape {
  bindings: Set<string>;
  expressions: t.Expression[];
}

function sameBindings(left: Set<string>, right: Set<string>): boolean {
  return (
    left.size === right.size &&
    [...left].every((binding) => right.has(binding))
  );
}

function sequenceShape(statements: t.Statement[]): ReplayShape | null {
  const bindings = new Set<string>();
  const expressions: t.Expression[] = [];
  for (const statement of statements) {
    const shape = statementShape(statement);
    if (shape === null) return null;
    for (const binding of shape.bindings) {
      if (bindings.has(binding)) return null;
      bindings.add(binding);
    }
    expressions.push(...shape.expressions);
  }
  return bindings.size === 0 ? null : { bindings, expressions };
}

function statementShape(statement: t.Statement): ReplayShape | null {
  if (
    t.isExpressionStatement(statement) &&
    t.isAssignmentExpression(statement.expression, { operator: '=' }) &&
    t.isIdentifier(statement.expression.left)
  ) {
    return {
      bindings: new Set([statement.expression.left.name]),
      expressions: [statement.expression.right],
    };
  }
  if (t.isBlockStatement(statement)) return sequenceShape(statement.body);
  if (t.isIfStatement(statement)) {
    const alternate = statement.alternate;
    if (alternate == null) return null;
    const consequent = statementShape(statement.consequent);
    const alternateShape = statementShape(alternate);
    if (
      consequent === null ||
      alternateShape === null ||
      !sameBindings(consequent.bindings, alternateShape.bindings)
    ) {
      return null;
    }
    return {
      bindings: consequent.bindings,
      expressions: [
        statement.test,
        ...consequent.expressions,
        ...alternateShape.expressions,
      ],
    };
  }
  return null;
}

function switchShape(statement: t.SwitchStatement): ReplayShape | null {
  if (!statement.cases.some((item) => item.test == null)) return null;
  let common: Set<string> | null = null;
  let pendingFallthrough = false;
  const expressions: t.Expression[] = [statement.discriminant];
  for (const item of statement.cases) {
    if (item.test != null) expressions.push(item.test);
    const body = [...item.consequent];
    if (body.length === 0) {
      pendingFallthrough = true;
      continue;
    }
    if (body.at(-1) && t.isBreakStatement(body.at(-1)!)) body.pop();
    if (body.some((child) => t.isBreakStatement(child))) return null;
    const shape = sequenceShape(body);
    if (shape === null) return null;
    pendingFallthrough = false;
    if (common === null) common = shape.bindings;
    else if (!sameBindings(common, shape.bindings)) return null;
    expressions.push(...shape.expressions);
  }
  return common === null || pendingFallthrough
    ? null
    : { bindings: common, expressions };
}

function belongsTo(violation: NodePath, statement: t.Statement): boolean {
  return (
    violation.node === statement ||
    violation.findParent((parent) => parent.node === statement) !== null
  );
}

function topLevelStatement(
  path: NodePath,
  programPath: NodePath<t.Program>,
): NodePath | null {
  let current: NodePath | null = path;
  while (current?.parentPath !== programPath) {
    current = current?.parentPath ?? null;
  }
  return current;
}

export function scanModuleControlFlow(
  ctx: Ctx,
  programPath: NodePath<t.Program>,
  analyze: (ctx: Ctx, expression: t.Node) => ComputedAnalysis,
): void {
  const bodyPaths = programPath.get('body');
  const bodyOrder = new Map(
    bodyPaths.map((statementPath, index) => [statementPath.node, index]),
  );
  for (const statementPath of bodyPaths) {
    if (
      !statementPath.isIfStatement() &&
      !statementPath.isSwitchStatement()
    ) {
      continue;
    }
    const flowStatement = statementPath.node as
      | t.IfStatement
      | t.SwitchStatement;
    const shape = statementPath.isIfStatement()
      ? statementShape(flowStatement as t.IfStatement)
      : switchShape(flowStatement as t.SwitchStatement);
    if (shape === null) continue;

    let eligible = true;
    const externalWrites: NodePath[] = [];
    for (const name of shape.bindings) {
      const binding = programPath.scope.getBinding(name);
      const declaration = binding?.path;
      const variableDeclaration = declaration?.parentPath;
      const topLevel =
        declaration === undefined
          ? null
          : topLevelStatement(declaration, programPath);
      if (
        binding === undefined ||
        !declaration?.isVariableDeclarator() ||
        !variableDeclaration?.isVariableDeclaration() ||
        (variableDeclaration.node.kind !== 'let' &&
          variableDeclaration.node.kind !== 'var') ||
        topLevel === null ||
        (bodyOrder.get(topLevel.node as t.Program['body'][number]) ??
          Number.MAX_SAFE_INTEGER) >=
          (bodyOrder.get(flowStatement) ?? -1)
      ) {
        eligible = false;
        break;
      }
      externalWrites.push(
        ...binding.constantViolations.filter(
          (violation) => !belongsTo(violation, flowStatement),
        ),
      );
    }
    if (!eligible) continue;

    const sources = new Set<string>();
    let impureReason: string | null = null;
    for (const expression of shape.expressions) {
      const result = analyze(ctx, expression);
      for (const read of result.reads) sources.add(read);
      if (result.impure && impureReason === null) {
        impureReason = result.reason ?? 'cannot be analyzed';
      }
    }
    if (sources.size === 0) continue;
    if (impureReason !== null) {
      throw statementPath.buildCodeFrameError(
        `memo-dom: module control-flow derivation ${impureReason}`,
      );
    }
    for (const name of shape.bindings) {
      if (sources.has(name)) {
        throw statementPath.buildCodeFrameError(
          `memo-dom: module control-flow derivation '${name}' reads its own previous value`,
        );
      }
    }
    if (externalWrites.length > 0) {
      throw externalWrites[0]!.buildCodeFrameError(
        `memo-dom: cannot assign module control-flow computed '${
          [...shape.bindings].sort().join(', ')
        }' outside its derivation`,
      );
    }

    const index = ctx.moduleControlFlow.length;
    const bindings = [...shape.bindings].sort();
    for (const name of bindings) registerState(ctx, name, 'computed');
    ctx.moduleControlFlow.push({
      statement: flowStatement,
      bindings,
      sources: [...sources].sort(),
      entityId:
        `${ctx.rootId}/$computed/${encodeURIComponent(ctx.moduleId)}#$flow${index}`,
    });
  }
}
