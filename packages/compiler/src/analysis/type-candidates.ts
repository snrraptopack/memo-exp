import * as t from '@babel/types';

type TypeAliases = Map<string, t.TSType>;

function declarationOf(statement: t.Statement): t.Declaration | null {
  if (t.isExportNamedDeclaration(statement)) {
    return statement.declaration ?? null;
  }
  return t.isDeclaration(statement) ? statement : null;
}

function typeAliases(program: t.Program): TypeAliases {
  const aliases: TypeAliases = new Map();
  for (const statement of program.body) {
    const declaration = declarationOf(statement);
    if (t.isTSTypeAliasDeclaration(declaration)) {
      aliases.set(declaration.id.name, declaration.typeAnnotation);
    }
  }
  return aliases;
}

function finiteStringValues(
  type: t.TSType,
  aliases: TypeAliases,
  visiting = new Set<string>(),
): string[] {
  if (t.isTSLiteralType(type) && t.isStringLiteral(type.literal)) {
    return [type.literal.value];
  }
  if (t.isTSUnionType(type)) {
    return type.types.flatMap((member) =>
      finiteStringValues(member, aliases, visiting),
    );
  }
  if (t.isTSParenthesizedType(type)) {
    return finiteStringValues(type.typeAnnotation, aliases, visiting);
  }
  if (t.isTSTypeReference(type) && t.isIdentifier(type.typeName)) {
    const name = type.typeName.name;
    if (visiting.has(name)) return [];
    const target = aliases.get(name);
    if (target === undefined) return [];
    const next = new Set(visiting);
    next.add(name);
    return finiteStringValues(target, aliases, next);
  }
  return [];
}

/**
 * Module state whose declared TypeScript type is a finite string-literal set.
 * The annotation is the contract: an initializer alone cannot prove every
 * value that later assignments or imported helper calls may produce.
 */
export function moduleStateStringCandidates(
  program: t.Program,
): Map<string, string[]> {
  const aliases = typeAliases(program);
  const output = new Map<string, string[]>();
  for (const statement of program.body) {
    const declaration = declarationOf(statement);
    if (!t.isVariableDeclaration(declaration)) continue;
    for (const declarator of declaration.declarations) {
      if (
        !t.isIdentifier(declarator.id) ||
        !t.isTSTypeAnnotation(declarator.id.typeAnnotation)
      ) {
        continue;
      }
      const values = [
        ...new Set(
          finiteStringValues(
            declarator.id.typeAnnotation.typeAnnotation,
            aliases,
          ),
        ),
      ];
      if (values.length > 0) output.set(declarator.id.name, values);
    }
  }
  return output;
}
