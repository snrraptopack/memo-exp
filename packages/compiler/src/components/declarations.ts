/**
 * Canonicalize supported component declaration spellings.
 *
 * The rest of the compiler intentionally operates on one component shape:
 * top-level function declarations. Normalizing uppercase const arrows and
 * function expressions before analysis keeps component/linker/emitter logic
 * unified instead of adding expression-path branches to every pass.
 */
import * as t from '@babel/types';
import { cloneNode as cloneEstreeNode } from '../ast';
import { nodeHasJsx } from '../context';

interface ProgramContainer {
  node: t.Program;
  buildCodeFrameError(message: string): Error;
  scope?: { crawl(): void };
}

interface ErrorPath {
  buildCodeFrameError(message: string): Error;
}

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
  at: ErrorPath,
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
    expression.params.map((parameter) => cloneEstreeNode(parameter, true)),
    t.isBlockStatement(expression.body)
      ? cloneEstreeNode(expression.body, true)
      : t.blockStatement([
          t.returnStatement(cloneEstreeNode(expression.body, true)),
        ]),
  );
  declaration.returnType =
    expression.returnType == null
      ? null
      : cloneEstreeNode(expression.returnType, true);
  declaration.typeParameters =
    expression.typeParameters == null
      ? null
      : cloneEstreeNode(expression.typeParameters, true);
  declaration.loc = expression.loc;
  return declaration;
}

function normalizedVariableStatement(
  declaration: t.VariableDeclaration,
  exported: boolean,
  at: ErrorPath,
): t.Statement[] {
  if (declaration.kind !== 'const') {
    return [
      exported
        ? t.exportNamedDeclaration(cloneEstreeNode(declaration, true))
        : cloneEstreeNode(declaration, true),
    ];
  }

  const statements: t.Statement[] = [];
  for (const declarator of declaration.declarations) {
    const expression = componentExpression(declarator);
    let statement: t.Statement;
    if (expression === null) {
      statement = t.variableDeclaration('const', [
        cloneEstreeNode(declarator, true),
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
  programPath: ProgramContainer,
): void {
  const body: t.Statement[] = [];
  let changed = false;

  for (const statement of programPath.node.body) {
    if (t.isVariableDeclaration(statement)) {
      const normalized = normalizedVariableStatement(
        statement,
        false,
        programPath,
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
        programPath,
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
  programPath.node.body = body;
  programPath.scope?.crawl();
}
