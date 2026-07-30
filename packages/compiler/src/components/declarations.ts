/**
 * Canonicalize supported component declaration spellings.
 *
 * The rest of the compiler intentionally operates on one component shape:
 * top-level function declarations. Normalizing uppercase const arrows and
 * function expressions before analysis keeps component/linker/emitter logic
 * unified instead of adding expression-path branches to every pass.
 */
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { nodeHasJsx } from '../context';

type ComponentExpression = t.ArrowFunctionExpression | t.FunctionExpression;

function componentExpression(
  declaration: t.VariableDeclarator,
): ComponentExpression | null {
  if (
    !t.isIdentifier(declaration.id) ||
    !/^[A-Z]/.test(declaration.id.name) ||
    (!t.isArrowFunctionExpression(declaration.init) &&
      !t.isFunctionExpression(declaration.init)) ||
    !nodeHasJsx(declaration.init.body)
  ) {
    return null;
  }
  return declaration.init;
}

function functionDeclaration(
  name: string,
  expression: ComponentExpression,
  at: NodePath,
): t.FunctionDeclaration {
  if (expression.async || expression.generator) {
    throw at.buildCodeFrameError(
      `memo-dom: component '${name}' must be synchronous`,
    );
  }
  if (
    t.isFunctionExpression(expression) &&
    expression.id != null &&
    expression.id.name !== name
  ) {
    throw at.buildCodeFrameError(
      `memo-dom: named component function expression '${expression.id.name}' must match binding '${name}'`,
    );
  }

  const declaration = t.functionDeclaration(
    t.identifier(name),
    expression.params.map((parameter) => t.cloneNode(parameter, true)),
    t.isBlockStatement(expression.body)
      ? t.cloneNode(expression.body, true)
      : t.blockStatement([
          t.returnStatement(t.cloneNode(expression.body, true)),
        ]),
  );
  declaration.returnType =
    expression.returnType == null
      ? null
      : t.cloneNode(expression.returnType, true);
  declaration.typeParameters =
    expression.typeParameters == null
      ? null
      : t.cloneNode(expression.typeParameters, true);
  declaration.loc = expression.loc;
  return declaration;
}

function normalizedVariableStatement(
  declaration: t.VariableDeclaration,
  exported: boolean,
  at: NodePath,
): t.Statement[] {
  if (declaration.kind !== 'const') {
    return [
      exported
        ? t.exportNamedDeclaration(t.cloneNode(declaration, true))
        : t.cloneNode(declaration, true),
    ];
  }

  const statements: t.Statement[] = [];
  for (const declarator of declaration.declarations) {
    const expression = componentExpression(declarator);
    let statement: t.Statement;
    if (expression === null) {
      statement = t.variableDeclaration('const', [
        t.cloneNode(declarator, true),
      ]);
    } else {
      statement = functionDeclaration(
        (declarator.id as t.Identifier).name,
        expression,
        at,
      );
    }
    statements.push(
      exported
        ? t.exportNamedDeclaration(
            statement as t.FunctionDeclaration | t.VariableDeclaration,
          )
        : statement,
    );
  }
  if (statements.length > 0) {
    t.inheritsComments(statements[0]!, declaration);
  }
  return statements;
}

/**
 * Rewrite top-level uppercase const function values containing JSX into the
 * canonical declaration shape consumed by all later passes.
 */
export function normalizeComponentDeclarations(
  programPath: NodePath<t.Program>,
): void {
  const body: t.Statement[] = [];
  let changed = false;

  for (const statementPath of programPath.get('body')) {
    const statement = statementPath.node;
    if (t.isVariableDeclaration(statement)) {
      const normalized = normalizedVariableStatement(
        statement,
        false,
        statementPath,
      );
      changed ||= normalized.some((item) => t.isFunctionDeclaration(item));
      body.push(...normalized);
      continue;
    }
    if (
      t.isExportNamedDeclaration(statement) &&
      t.isVariableDeclaration(statement.declaration)
    ) {
      const normalized = normalizedVariableStatement(
        statement.declaration,
        true,
        statementPath,
      );
      changed ||= normalized.some(
        (item) =>
          t.isExportNamedDeclaration(item) &&
          t.isFunctionDeclaration(item.declaration),
      );
      body.push(...normalized);
      continue;
    }
    body.push(statement);
  }

  if (!changed) return;
  programPath.set('body', body);
  programPath.scope.crawl();
}
