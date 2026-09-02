import type { BaseNode } from '../ast';
import { walkAst } from '../ast';

interface ProgramLike extends BaseNode {
  type: 'Program';
  body: BaseNode[];
}

type TypeAliases = Map<string, BaseNode>;

function fields(node: BaseNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

function node(value: unknown): BaseNode | null {
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string'
  ) {
    return value as BaseNode;
  }
  return null;
}

function nodes(value: unknown): BaseNode[] {
  if (!Array.isArray(value)) return [];
  const values: readonly unknown[] = value;
  return values.flatMap((item) => {
    const child = node(item);
    return child === null ? [] : [child];
  });
}

function identifierName(value: unknown): string | null {
  const identifier = node(value);
  if (identifier?.type !== 'Identifier') return null;
  const name = fields(identifier).name;
  return typeof name === 'string' ? name : null;
}

function stringLiteralValue(value: unknown): string | null {
  const literal = node(value);
  if (literal === null) return null;
  if (literal.type !== 'Literal' && literal.type !== 'StringLiteral') return null;
  const literalValue = fields(literal).value;
  return typeof literalValue === 'string' ? literalValue : null;
}

function declarationOf(statement: BaseNode): BaseNode | null {
  if (statement.type === 'ExportNamedDeclaration') {
    return node(fields(statement).declaration);
  }
  return statement.type.endsWith('Declaration') ? statement : null;
}

function typeAliases(program: ProgramLike): TypeAliases {
  const aliases: TypeAliases = new Map();
  for (const statement of program.body) {
    const declaration = declarationOf(statement);
    if (declaration?.type !== 'TSTypeAliasDeclaration') continue;
    const name = identifierName(fields(declaration).id);
    const annotation = node(fields(declaration).typeAnnotation);
    if (name !== null && annotation !== null) aliases.set(name, annotation);
  }
  return aliases;
}

function typeDeclarations(program: ProgramLike): TypeAliases {
  const declarations = typeAliases(program);
  for (const statement of program.body) {
    const declaration = declarationOf(statement);
    if (declaration?.type !== 'TSInterfaceDeclaration') continue;
    const name = identifierName(fields(declaration).id);
    const body = node(fields(declaration).body);
    if (name !== null && body !== null) declarations.set(name, body);
  }
  return declarations;
}

function finiteStringValues(
  type: BaseNode,
  aliases: TypeAliases,
  visiting = new Set<string>(),
): string[] {
  const typeFields = fields(type);
  if (type.type === 'TSLiteralType') {
    const value = stringLiteralValue(typeFields.literal);
    return value === null ? [] : [value];
  }
  if (type.type === 'TSUnionType') {
    const members = nodes(typeFields.types).map((member) =>
      finiteStringValues(member, aliases, visiting),
    );
    return members.some((member) => member.length === 0)
      ? []
      : members.flat();
  }
  if (type.type === 'TSIntersectionType') {
    return nodes(typeFields.types).flatMap((member) =>
      finiteStringValues(member, aliases, visiting),
    );
  }
  if (type.type === 'TSParenthesizedType') {
    const annotation = node(typeFields.typeAnnotation);
    return annotation === null
      ? []
      : finiteStringValues(annotation, aliases, visiting);
  }
  if (type.type === 'TSTypeLiteral') {
    return nodes(typeFields.members).flatMap((member) => {
      if (
        member.type !== 'TSPropertySignature' &&
        member.type !== 'TSIndexSignature'
      ) {
        return [];
      }
      const annotation = node(fields(member).typeAnnotation);
      const nested =
        annotation?.type === 'TSTypeAnnotation'
          ? node(fields(annotation).typeAnnotation)
          : null;
      return nested === null
        ? []
        : finiteStringValues(nested, aliases, visiting);
    });
  }
  if (type.type === 'TSMappedType') {
    const annotation = node(typeFields.typeAnnotation);
    return annotation === null
      ? []
      : finiteStringValues(annotation, aliases, visiting);
  }
  if (type.type === 'TSTypeReference') {
    const name = identifierName(typeFields.typeName);
    if (name === null) return [];
    const typeArguments = node(typeFields.typeArguments);
    if (
      (name === 'Record' || name === 'Readonly' || name === 'Partial') &&
      typeArguments?.type === 'TSTypeParameterInstantiation'
    ) {
      const parameters = nodes(fields(typeArguments).params);
      const target = name === 'Record' ? parameters[1] : parameters[0];
      return target === undefined
        ? []
        : finiteStringValues(target, aliases, visiting);
    }
    if (visiting.has(name)) return [];
    const target = aliases.get(name);
    if (target === undefined) return [];
    const next = new Set(visiting);
    next.add(name);
    return finiteStringValues(target, aliases, next);
  }
  return [];
}

function annotatedType(value: unknown): BaseNode | null {
  const annotation = node(value);
  return annotation?.type === 'TSTypeAnnotation'
    ? node(fields(annotation).typeAnnotation)
    : null;
}

function unwrapPattern(pattern: BaseNode): BaseNode {
  if (pattern.type === 'AssignmentPattern') {
    return node(fields(pattern).left) ?? pattern;
  }
  if (pattern.type === 'TSParameterProperty') {
    return node(fields(pattern).parameter) ?? pattern;
  }
  return pattern;
}

function propertyType(
  type: BaseNode,
  name: string,
  declarations: TypeAliases,
  visiting = new Set<string>(),
): BaseNode | null {
  if (type.type === 'TSTypeAnnotation') {
    const annotation = node(fields(type).typeAnnotation);
    return annotation === null
      ? null
      : propertyType(annotation, name, declarations, visiting);
  }
  if (type.type === 'TSParenthesizedType') {
    const annotation = node(fields(type).typeAnnotation);
    return annotation === null
      ? null
      : propertyType(annotation, name, declarations, visiting);
  }
  if (type.type === 'TSTypeReference') {
    const reference = identifierName(fields(type).typeName);
    if (reference === null || visiting.has(reference)) return null;
    const target = declarations.get(reference);
    if (target === undefined) return null;
    const next = new Set(visiting);
    next.add(reference);
    return propertyType(target, name, declarations, next);
  }
  if (type.type === 'TSUnionType') {
    const matches = nodes(fields(type).types).map((member) =>
      propertyType(member, name, declarations, visiting),
    );
    if (matches.some((match) => match === null)) return null;
    const present = matches.filter((match): match is BaseNode => match !== null);
    return present.length === 1
      ? present[0]!
      : { type: 'TSUnionType', types: present } as BaseNode;
  }
  if (type.type === 'TSIntersectionType') {
    const matches = nodes(fields(type).types).flatMap((member) => {
      const match = propertyType(member, name, declarations, visiting);
      return match === null ? [] : [match];
    });
    return matches.length === 0
      ? null
      : matches.length === 1
      ? matches[0]!
      : { type: 'TSUnionType', types: matches } as BaseNode;
  }
  const members =
    type.type === 'TSTypeLiteral'
      ? nodes(fields(type).members)
      : type.type === 'TSInterfaceBody'
      ? nodes(fields(type).body)
      : [];
  for (const member of members) {
    if (member.type !== 'TSPropertySignature') continue;
    const key = identifierName(fields(member).key) ??
      stringLiteralValue(fields(member).key);
    if (key !== name) continue;
    return annotatedType(fields(member).typeAnnotation);
  }
  return null;
}

/**
 * Finite string contracts attached to lexical bindings, including component
 * props whose type lives on an enclosing destructuring pattern.
 */
export function lexicalBindingStringCandidates(
  input: BaseNode,
): Map<string, string[]> {
  const output = new Map<string, string[]>();
  if (input.type !== 'Program' || !Array.isArray(fields(input).body)) {
    return output;
  }
  const program = input as ProgramLike;
  const declarations = typeDeclarations(program);

  const record = (
    rawPattern: BaseNode,
    contextualType: BaseNode | null,
  ): void => {
    const pattern = unwrapPattern(rawPattern);
    const ownType = annotatedType(fields(pattern).typeAnnotation);
    const type = ownType ?? contextualType;
    if (pattern.type === 'Identifier') {
      if (type === null) return;
      const values = [...new Set(finiteStringValues(type, declarations))];
      const key = lexicalBindingKey(pattern);
      if (values.length > 0 && key !== null) output.set(key, values);
      return;
    }
    if (pattern.type !== 'ObjectPattern' || type === null) return;
    for (const property of nodes(fields(pattern).properties)) {
      if (
        property.type !== 'Property' &&
        property.type !== 'ObjectProperty'
      ) {
        continue;
      }
      const key = identifierName(fields(property).key) ??
        stringLiteralValue(fields(property).key);
      const value = node(fields(property).value);
      if (key === null || value === null) continue;
      record(value, propertyType(type, key, declarations));
    }
  };

  walkAst<BaseNode>(program, {
    enter(current) {
      if (current.type === 'VariableDeclarator') {
        const id = node(fields(current).id);
        if (id !== null) record(id, null);
        return;
      }
      if (
        current.type !== 'FunctionDeclaration' &&
        current.type !== 'FunctionExpression' &&
        current.type !== 'ArrowFunctionExpression'
      ) {
        return;
      }
      for (const parameter of nodes(fields(current).params)) {
        record(parameter, null);
      }
    },
  });
  return output;
}

/** Stable across parser-neutral AST clones that preserve authored ranges. */
export function lexicalBindingKey(identifier: BaseNode): string | null {
  const name = identifierName(identifier);
  if (name === null) return null;
  const record = fields(identifier);
  const start = typeof record.start === 'number'
    ? record.start
    : identifier.range?.[0];
  const end = typeof record.end === 'number'
    ? record.end
    : identifier.range?.[1];
  if (start !== undefined && end !== undefined) {
    return `${name}:${start}:${end}`;
  }
  const location = identifier.loc;
  return location == null
    ? null
    : `${name}:${location.start.line}:${location.start.column}:` +
      `${location.end.line}:${location.end.column}`;
}

/**
 * Module state whose declared TypeScript type is a finite string-literal set.
 * The annotation is the contract: an initializer alone cannot prove every
 * value that later assignments or imported helper calls may produce.
 */
export function moduleStateStringCandidates(
  program: ProgramLike,
): Map<string, string[]> {
  const aliases = typeAliases(program);
  const output = new Map<string, string[]>();
  for (const statement of program.body) {
    const declaration = declarationOf(statement);
    if (declaration?.type !== 'VariableDeclaration') continue;
    for (const declarator of nodes(fields(declaration).declarations)) {
      const declaratorFields = fields(declarator);
      const name = identifierName(declaratorFields.id);
      const id = node(declaratorFields.id);
      const type = id === null ? null : annotatedType(fields(id).typeAnnotation);
      if (name === null || type === null) continue;
      const values = [...new Set(finiteStringValues(type, aliases))];
      if (values.length > 0) output.set(name, values);
    }
  }
  return output;
}

/**
 * Functions whose declared return type is a finite string-literal set.
 * This is exported through linked function metadata so a caller can safely
 * lower `const Tag = chooseTag(...); <Tag />` without seeing the helper body.
 */
export function moduleFunctionStringCandidates(
  program: ProgramLike,
): Map<string, string[]> {
  const aliases = typeAliases(program);
  const output = new Map<string, string[]>();

  const record = (name: string, returnType: unknown): void => {
    const type = annotatedType(returnType);
    if (type === null) return;
    const values = [...new Set(finiteStringValues(type, aliases))];
    if (values.length > 0) output.set(name, values);
  };

  for (const statement of program.body) {
    const declaration = declarationOf(statement);
    if (declaration?.type === 'FunctionDeclaration') {
      const declarationFields = fields(declaration);
      const name = identifierName(declarationFields.id);
      if (name !== null) record(name, declarationFields.returnType);
      continue;
    }
    if (declaration?.type !== 'VariableDeclaration') continue;
    for (const declarator of nodes(fields(declaration).declarations)) {
      const declaratorFields = fields(declarator);
      const name = identifierName(declaratorFields.id);
      const initializer = node(declaratorFields.init);
      if (
        name !== null &&
        (initializer?.type === 'ArrowFunctionExpression' ||
          initializer?.type === 'FunctionExpression')
      ) {
        record(name, fields(initializer).returnType);
      }
    }
  }
  return output;
}
