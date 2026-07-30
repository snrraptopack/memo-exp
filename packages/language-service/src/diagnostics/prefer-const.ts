import type * as ts from 'typescript';
import {
  diagnosticCodes,
  diagnosticSource,
  preferConstMessage,
} from './catalog';

type TypeScript = typeof ts;

interface Candidate {
  declarationList: ts.VariableDeclarationList;
  names: string[];
  symbols: ts.Symbol[];
}

export function collectPreferConstDiagnostics(
  typescript: TypeScript,
  program: ts.Program,
  sourceFile: ts.SourceFile,
): ts.DiagnosticWithLocation[] {
  if (sourceFile.isDeclarationFile) return [];
  const checker = program.getTypeChecker();
  const candidates = collectCandidates(typescript, checker, sourceFile);
  if (candidates.length === 0) return [];

  const candidateSymbols = new Set(
    candidates.flatMap((candidate) => candidate.symbols),
  );
  const reassigned = collectReassignedSymbols(
    typescript,
    checker,
    sourceFile,
    candidateSymbols,
  );

  return candidates
    .filter((candidate) =>
      candidate.symbols.every((symbol) => !reassigned.has(symbol)),
    )
    .map((candidate) => ({
      file: sourceFile,
      start: candidate.declarationList.getStart(sourceFile),
      length: 'let'.length,
      category: typescript.DiagnosticCategory.Suggestion,
      code: diagnosticCodes.preferConst,
      source: diagnosticSource,
      messageText: preferConstMessage(candidate.names),
    }));
}

export function createPreferConstCodeFix(
  typescript: TypeScript,
  sourceFile: ts.SourceFile,
  diagnosticStart: number,
): ts.CodeFixAction | null {
  const declarationList = findDeclarationList(
    typescript,
    sourceFile,
    diagnosticStart,
  );
  if (declarationList === null) return null;
  return {
    fixName: 'memoizedDomPreferConst',
    description: 'Change let to const',
    changes: [
      {
        fileName: sourceFile.fileName,
        textChanges: [
          {
            span: {
              start: declarationList.getStart(sourceFile),
              length: 'let'.length,
            },
            newText: 'const',
          },
        ],
      },
    ],
  };
}

function collectCandidates(
  typescript: TypeScript,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): Candidate[] {
  const candidates: Candidate[] = [];
  const visit = (node: ts.Node): void => {
    if (
      typescript.isVariableStatement(node) &&
      (node.declarationList.flags & typescript.NodeFlags.Let) !== 0 &&
      node.declarationList.declarations.every(
        (declaration) => declaration.initializer !== undefined,
      )
    ) {
      const identifiers = node.declarationList.declarations.flatMap(
        (declaration) =>
          bindingIdentifiers(typescript, declaration.name),
      );
      const bindings = identifiers
        .map((identifier) => ({
          name: identifier.text,
          symbol: checker.getSymbolAtLocation(identifier),
        }))
        .filter(
          (
            binding,
          ): binding is { name: string; symbol: ts.Symbol } =>
            binding.symbol !== undefined,
        );
      if (bindings.length === identifiers.length && bindings.length > 0) {
        candidates.push({
          declarationList: node.declarationList,
          names: bindings.map((binding) => binding.name),
          symbols: bindings.map((binding) => binding.symbol),
        });
      }
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return candidates;
}

function collectReassignedSymbols(
  typescript: TypeScript,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  candidates: ReadonlySet<ts.Symbol>,
): Set<ts.Symbol> {
  const reassigned = new Set<ts.Symbol>();
  const markTarget = (node: ts.Node): void => {
    const target = unwrapTarget(typescript, node);
    if (typescript.isIdentifier(target)) {
      const symbol = checker.getSymbolAtLocation(target);
      if (symbol !== undefined && candidates.has(symbol)) {
        reassigned.add(symbol);
      }
      return;
    }
    if (typescript.isArrayLiteralExpression(target)) {
      for (const element of target.elements) {
        if (!typescript.isOmittedExpression(element)) markTarget(element);
      }
      return;
    }
    if (typescript.isObjectLiteralExpression(target)) {
      for (const property of target.properties) {
        if (typescript.isShorthandPropertyAssignment(property)) {
          markTarget(property.name);
        } else if (typescript.isPropertyAssignment(property)) {
          markTarget(property.initializer);
        } else if (typescript.isSpreadAssignment(property)) {
          markTarget(property.expression);
        }
      }
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      typescript.isBinaryExpression(node) &&
      node.operatorToken.kind >= typescript.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= typescript.SyntaxKind.LastAssignment
    ) {
      markTarget(node.left);
    } else if (
      (typescript.isPrefixUnaryExpression(node) ||
        typescript.isPostfixUnaryExpression(node)) &&
      (node.operator === typescript.SyntaxKind.PlusPlusToken ||
        node.operator === typescript.SyntaxKind.MinusMinusToken)
    ) {
      markTarget(node.operand);
    } else if (
      (typescript.isForInStatement(node) ||
        typescript.isForOfStatement(node)) &&
      !typescript.isVariableDeclarationList(node.initializer)
    ) {
      markTarget(node.initializer);
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return reassigned;
}

function bindingIdentifiers(
  typescript: TypeScript,
  name: ts.BindingName,
): ts.Identifier[] {
  if (typescript.isIdentifier(name)) return [name];
  return name.elements.flatMap((element) =>
    typescript.isOmittedExpression(element)
      ? []
      : bindingIdentifiers(typescript, element.name),
  );
}

function unwrapTarget(typescript: TypeScript, node: ts.Node): ts.Node {
  while (
    typescript.isParenthesizedExpression(node) ||
    typescript.isAsExpression(node) ||
    typescript.isTypeAssertionExpression(node) ||
    typescript.isNonNullExpression(node) ||
    typescript.isSatisfiesExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

function findDeclarationList(
  typescript: TypeScript,
  sourceFile: ts.SourceFile,
  start: number,
): ts.VariableDeclarationList | null {
  let found: ts.VariableDeclarationList | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null || start < node.getFullStart() || start > node.end) {
      return;
    }
    if (
      typescript.isVariableDeclarationList(node) &&
      (node.flags & typescript.NodeFlags.Let) !== 0 &&
      node.getStart(sourceFile) === start
    ) {
      found = node;
      return;
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}
