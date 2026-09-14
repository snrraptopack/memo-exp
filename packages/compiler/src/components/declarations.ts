/**
 * Canonicalize supported component declaration spellings.
 *
 * The rest of the compiler intentionally operates on one component shape:
 * top-level function declarations. Normalizing uppercase const arrows and
 * function expressions before analysis keeps component/linker/emitter logic
 * unified instead of adding expression-path branches to every pass.
 */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode as cloneEstreeNode,
  inheritComments,
  type BaseNode,
} from '../ast';
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
    !astFactory.isIdentifier(declaration.id) ||
    !/^[A-Z]/.test(declaration.id.name) ||
    (!astFactory.isArrowFunctionExpression(declaration.init) &&
      !astFactory.isFunctionExpression(declaration.init)) ||
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
    astFactory.isFunctionExpression(expression) &&
    expression.id != null &&
    expression.id.name !== name
  ) {
    throw at.buildCodeFrameError(
      `memo-dom: named component function expression '${expression.id.name}' must match binding '${name}'`,
    );
  }

  const declaration = astFactory.functionDeclaration(
    astFactory.identifier(name),
    expression.params.map((parameter) => cloneEstreeNode(parameter, true)),
    astFactory.isBlockStatement(expression.body)
      ? cloneEstreeNode(expression.body, true)
      : astFactory.blockStatement([
          astFactory.returnStatement(cloneEstreeNode(expression.body, true)),
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
        ? astFactory.exportNamedDeclaration(cloneEstreeNode(declaration, true))
        : cloneEstreeNode(declaration, true),
    ];
  }

  const statements: t.Statement[] = [];
  for (const declarator of declaration.declarations) {
    const expression = componentExpression(declarator);
    let statement: t.Statement;
    if (expression === null) {
      if (
        astFactory.isIdentifier(declarator.id) &&
        /^[A-Z]/.test(declarator.id.name) &&
        declarator.init != null &&
        nodeHasJsx(declarator.init)
      ) {
        throw at.buildCodeFrameError(
          `memo-dom: '${declarator.id.name}' contains JSX but is not a plain function; declare components as 'function ${declarator.id.name}() { ... }' — wrappers like memo() are not supported`,
        );
      }
      statement = astFactory.variableDeclaration('const', [
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
        ? astFactory.exportNamedDeclaration(
            statement as t.FunctionDeclaration | t.VariableDeclaration,
          )
        : statement,
    );
  }
  if (statements.length > 0) {
    inheritComments(
      statements[0]! as unknown as BaseNode,
      declaration as unknown as BaseNode,
    );
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
    if (astFactory.isVariableDeclaration(statement)) {
      const normalized = normalizedVariableStatement(
        statement,
        false,
        programPath,
      );
      changed ||= normalized.some((item) => astFactory.isFunctionDeclaration(item));
      body.push(...normalized);
      continue;
    }
    if (
      astFactory.isExportNamedDeclaration(statement) &&
      astFactory.isVariableDeclaration(statement.declaration)
    ) {
      const normalized = normalizedVariableStatement(
        statement.declaration,
        true,
        programPath,
      );
      changed ||= normalized.some(
        (item) =>
          astFactory.isExportNamedDeclaration(item) &&
          astFactory.isFunctionDeclaration(item.declaration),
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
