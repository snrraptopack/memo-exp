/**
 * Pure exhaustive module-level if/switch derivations.
 */
import type * as t from '@babel/types';
import * as astFactory from './ast/factory';
import type { BaseNode } from './ast';
import {
  astBindingAt,
  registerState,
  type ComputedAnalysis,
  type Ctx,
} from './context';

interface ProgramContainer {
  node: BaseNode;
  buildCodeFrameError(message: string): Error;
}

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
    astFactory.isExpressionStatement(statement) &&
    astFactory.isAssignmentExpression(statement.expression, { operator: '=' }) &&
    astFactory.isIdentifier(statement.expression.left)
  ) {
    return {
      bindings: new Set([statement.expression.left.name]),
      expressions: [statement.expression.right],
    };
  }
  if (astFactory.isBlockStatement(statement)) return sequenceShape(statement.body);
  if (astFactory.isIfStatement(statement)) {
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
    if (body.at(-1) && astFactory.isBreakStatement(body.at(-1)!)) body.pop();
    if (body.some((child) => astFactory.isBreakStatement(child))) return null;
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

function belongsTo(ctx: Ctx, node: BaseNode, owner: BaseNode): boolean {
  let current: BaseNode | null = node;
  while (current !== null) {
    if (current === owner) return true;
    current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  }
  return false;
}

function topLevelStatement(
  ctx: Ctx,
  node: BaseNode,
  program: BaseNode,
): BaseNode | null {
  let current: BaseNode | null = node;
  while (
    current !== null &&
    ctx.astAnalysis?.parentByNode.get(current) !== program
  ) {
    current = ctx.astAnalysis?.parentByNode.get(current) ?? null;
  }
  return current;
}

export function scanModuleControlFlow(
  ctx: Ctx,
  programPath: ProgramContainer,
  analyze: (ctx: Ctx, expression: BaseNode) => ComputedAnalysis,
): void {
  const programBody = (
    programPath.node as unknown as { body: t.Program['body'] }
  ).body;
  const bodyOrder = new Map(
    programBody.map((statement, index) => [statement, index]),
  );
  for (const statement of programBody) {
    if (!astFactory.isIfStatement(statement) && !astFactory.isSwitchStatement(statement)) continue;
    const flowStatement = statement;
    const shape = astFactory.isIfStatement(flowStatement)
      ? statementShape(flowStatement)
      : switchShape(flowStatement);
    if (shape === null) continue;

    let eligible = true;
    const externalWrites: BaseNode[] = [];
    for (const name of shape.bindings) {
      const binding = astBindingAt(ctx, flowStatement, name);
      const declaration = binding?.identifier;
      const declarator =
        declaration === undefined
          ? null
          : ctx.astAnalysis?.parentByNode.get(declaration) ?? null;
      const topLevel =
        declaration === undefined
          ? null
          : topLevelStatement(ctx, declaration, programPath.node);
      if (
        binding === undefined ||
        declarator?.type !== 'VariableDeclarator' ||
        (binding.kind !== 'let' && binding.kind !== 'var') ||
        topLevel === null ||
        (bodyOrder.get(topLevel as t.Program['body'][number]) ??
          Number.MAX_SAFE_INTEGER) >=
          (bodyOrder.get(flowStatement) ?? -1)
      ) {
        eligible = false;
        break;
      }
      externalWrites.push(
        ...binding.constantViolations.filter(
          (violation) => !belongsTo(ctx, violation, flowStatement),
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
      throw programPath.buildCodeFrameError(
        `memo-dom: module control-flow derivation ${impureReason}`,
      );
    }
    for (const name of shape.bindings) {
      if (sources.has(name)) {
        throw programPath.buildCodeFrameError(
          `memo-dom: module control-flow derivation '${name}' reads its own previous value`,
        );
      }
    }
    if (externalWrites.length > 0) {
      throw programPath.buildCodeFrameError(
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
