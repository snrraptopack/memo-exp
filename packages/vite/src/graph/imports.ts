/**
 * Extracts statically imported value modules from Rolldown's parsed AST.
 */
interface ImportSpecifier {
  importKind?: 'type' | 'value';
}

interface ImportDeclaration {
  type: 'ImportDeclaration';
  importKind?: 'type' | 'value';
  source: {
    value?: unknown;
    loc?: {
      start: { line: number; column: number };
    } | null;
  };
  specifiers?: readonly ImportSpecifier[];
}

interface Program {
  body: readonly unknown[];
}

function isImportDeclaration(node: unknown): node is ImportDeclaration {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as { type?: unknown }).type === 'ImportDeclaration'
  );
}

export interface ValueImport {
  readonly specifier: string;
  readonly line?: number;
  readonly column?: number;
}

export function valueImports(program: Program): ValueImport[] {
  const imports: ValueImport[] = [];
  for (const node of program.body) {
    if (!isImportDeclaration(node) || node.importKind === 'type') continue;
    const specifiers = node.specifiers ?? [];
    if (
      specifiers.length > 0 &&
      specifiers.every((specifier) => specifier.importKind === 'type')
    ) {
      continue;
    }
    if (typeof node.source.value === 'string') {
      const start = node.source.loc?.start;
      imports.push({
        specifier: node.source.value,
        ...(start === undefined
          ? {}
          : { line: start.line, column: start.column }),
      });
    }
  }
  return imports;
}

export type ParsedProgram = Program;
