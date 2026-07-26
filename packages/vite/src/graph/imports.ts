/**
 * Extracts statically imported value modules from Rolldown's parsed AST.
 */
interface ImportSpecifier {
  importKind?: 'type' | 'value';
}

interface ImportDeclaration {
  type: 'ImportDeclaration';
  importKind?: 'type' | 'value';
  source: { value?: unknown };
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

export function valueImports(program: Program): string[] {
  const imports: string[] = [];
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
      imports.push(node.source.value);
    }
  }
  return imports;
}

export type ParsedProgram = Program;
