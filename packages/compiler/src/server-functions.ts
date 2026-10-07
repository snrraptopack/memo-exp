/** Parser-neutral discovery and client-facade generation for named HTTP functions. */
import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import {
  memoizedEstreeFrontend,
  parseWithEstreeFrontendOrThrow,
  type BaseNode,
  type EstreeFrontend,
} from './ast';
import { unwrapTypeExpression } from './context';
import { compilerError } from './errors';
import type { AstComment } from './ast/parser';

/** Only emitted in server implementation modules, never in client facades. */
export const serverFunctionMetadataExport = '__mmdServerFunctionMetadata';

export type ServerFunctionMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE';

export type ServerFunctionQueryKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]'
  | 'boolean[]';

export interface ServerFunctionParameter {
  readonly name: string;
  readonly optional: boolean;
  /** Present only for GET query decoding; mutation bodies retain JSON types. */
  readonly queryKind?: ServerFunctionQueryKind;
}

export interface ServerFunctionDefinition {
  readonly exported: string;
  readonly local: string;
  readonly method: ServerFunctionMethod;
  readonly path: string;
  readonly parameters: readonly ServerFunctionParameter[];
  /** Source expressions resolved in the implementation module's scope. */
  readonly middleware?: string;
  readonly input?: string;
}

export interface ServerFunctionModule {
  readonly moduleId: string;
  readonly moduleName: string;
  readonly middlewareExport: boolean;
  readonly functions: readonly ServerFunctionDefinition[];
}

export interface AnalyzeServerFunctionOptions {
  readonly moduleId: string;
  readonly functionsRoot?: string;
  readonly frontend?: EstreeFrontend;
}

interface FunctionBinding {
  readonly local: string;
  readonly declaration: BaseNode;
  readonly node:
    | t.FunctionDeclaration
    | t.FunctionExpression
    | t.ArrowFunctionExpression;
}

function record(node: BaseNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

function cleanModuleId(moduleId: string): string {
  return moduleId.replaceAll('\\', '/').split(/[?#]/, 1)[0]!;
}

export function serverFunctionModuleName(
  moduleId: string,
  functionsRoot = 'server/functions',
): string {
  const clean = cleanModuleId(moduleId);
  const normalizedRoot = functionsRoot
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '');
  const marker = `/${normalizedRoot}/`;
  const rooted = `/${clean.replace(/^\.\//, '').replace(/^\/+/, '')}`;
  const index = rooted.lastIndexOf(marker);
  if (index === -1) {
    throw compilerError(
      `memo-dom: server function module '${moduleId}' is outside '${normalizedRoot}/'`,
      moduleId,
    );
  }
  const relative = rooted.slice(index + marker.length)
    .replace(/\.(?:[cm]?[jt]sx?|tsrx)$/i, '');
  if (relative === '' || relative === '_middleware') {
    return relative;
  }
  return relative
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function functionBindings(program: t.Program): Map<string, FunctionBinding> {
  const functions = new Map<string, FunctionBinding>();
  for (const statement of program.body) {
    const declaration = astFactory.isExportNamedDeclaration(statement)
      ? statement.declaration
      : statement;
    if (
      astFactory.isFunctionDeclaration(declaration) &&
      declaration.id !== null
    ) {
      functions.set(declaration.id.name, {
        local: declaration.id.name,
        declaration: statement as unknown as BaseNode,
        node: declaration,
      });
      continue;
    }
    if (!astFactory.isVariableDeclaration(declaration)) continue;
    for (const item of declaration.declarations) {
      if (!astFactory.isIdentifier(item.id) || item.init === null) continue;
      const init = astFactory.isExpression(item.init)
        ? unwrapTypeExpression(item.init)
        : item.init;
      if (
        astFactory.isFunctionExpression(init) ||
        astFactory.isArrowFunctionExpression(init)
      ) {
        functions.set(item.id.name, {
          local: item.id.name, node: init,
          declaration: statement as unknown as BaseNode,
        });
      }
    }
  }
  return functions;
}

function nodeStart(node: BaseNode): number {
  return (record(node).start as number | undefined) ?? node.range?.[0] ?? 0;
}

function moduleBindings(program: t.Program): Set<string> {
  const names = new Set<string>();
  function pattern(node: BaseNode): void {
    const value = record(node);
    if (node.type === 'Identifier') names.add(value.name as string);
    else if (node.type === 'RestElement') pattern(value.argument as BaseNode);
    else if (node.type === 'AssignmentPattern') pattern(value.left as BaseNode);
    else if (node.type === 'ArrayPattern') {
      for (const item of value.elements as Array<BaseNode | null>) {
        if (item !== null) pattern(item);
      }
    } else if (node.type === 'ObjectPattern') {
      for (const property of value.properties as BaseNode[]) {
        pattern(property.type === 'RestElement'
          ? property : record(property).value as BaseNode);
      }
    }
  }
  for (const statement of program.body) {
    const declaration = astFactory.isExportNamedDeclaration(statement)
      ? statement.declaration : statement;
    if (declaration === null) continue;
    const value = record(declaration as unknown as BaseNode);
    if (declaration.type === 'ImportDeclaration') {
      if (value.importKind === 'type') continue;
      for (const specifier of value.specifiers as BaseNode[]) {
        if (record(specifier).importKind !== 'type') {
          pattern(record(specifier).local as BaseNode);
        }
      }
    } else if (astFactory.isVariableDeclaration(declaration)) {
      for (const item of declaration.declarations) pattern(item.id as unknown as BaseNode);
    } else if (
      ['FunctionDeclaration', 'ClassDeclaration', 'TSEnumDeclaration'].includes(declaration.type) &&
      value.id != null
    ) pattern(value.id as BaseNode);
  }
  return names;
}

function annotationExpression(
  expression: string,
  tag: string,
  names: ReadonlySet<string>,
  moduleId: string,
  at: BaseNode,
): void {
  const fail = (message: string): never => {
    throw compilerError(`memo-dom: [MMD-S014] @${tag}: ${message}`, moduleId, at);
  };
  let parsed;
  try {
    parsed = parseWithEstreeFrontendOrThrow(memoizedEstreeFrontend,
      `const __annotation = (${expression});`, { filename: 'annotation.ts' });
  } catch {
    fail('expected a valid TypeScript expression');
  }
  const declaration = parsed!.program.body[0]!;
  if (parsed!.program.body.length !== 1 || declaration.type !== 'VariableDeclaration') {
    fail('expected a single expression');
  }
  const item = (record(declaration).declarations as BaseNode[])[0]!;
  const root = record(item).init as BaseNode;
  if (tag === 'middleware' && root.type !== 'ArrayExpression') {
    fail('expected an array of middleware');
  }
  function visit(node: BaseNode): void {
    const value = record(node);
    switch (node.type) {
      case 'Identifier':
        if (!names.has(value.name as string) && value.name !== 'undefined') {
          fail(`'${String(value.name)}' is not a runtime binding in this module`);
        }
        return;
      case 'Literal': return;
      case 'MemberExpression':
        visit(value.object as BaseNode);
        if (value.computed) visit(value.property as BaseNode);
        return;
      case 'Property':
        if (value.computed) visit(value.key as BaseNode);
        visit(value.value as BaseNode);
        return;
      case 'CallExpression':
        visit(value.callee as BaseNode);
        for (const argument of value.arguments as BaseNode[]) visit(argument);
        return;
      case 'ArrayExpression':
        for (const element of value.elements as Array<BaseNode | null>) {
          if (element !== null) visit(element);
        }
        return;
      case 'ObjectExpression':
        for (const property of value.properties as BaseNode[]) visit(property);
        return;
      case 'SpreadElement': case 'UnaryExpression':
        visit(value.argument as BaseNode); return;
      case 'TSAsExpression': case 'TSSatisfiesExpression': case 'TSNonNullExpression':
        visit(value.expression as BaseNode); return;
      default:
        fail('use a module binding, member access, or factory call; declare more complex expressions in TypeScript');
    }
  }
  visit(root);
}

/** Locate JSDoc tags without interpreting @ inside annotation expressions. */
function annotationTags(text: string): Array<{ name: string; start: number; end: number }> {
  const tags: Array<{ name: string; start: number; end: number }> = [];
  let expression = false;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (expression) {
      if (quote !== null) {
        if (character === '\\') index++;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === '`') {
        quote = character;
        continue;
      }
      if (character === '/' && text[index + 1] === '/') {
        const newline = text.indexOf('\n', index);
        index = newline === -1 ? text.length : newline;
        continue;
      }
      if ('([{'.includes(character)) depth++;
      else if (')]}'.includes(character)) depth--;
    }
    if (character !== '@' || depth !== 0 || (index > 0 && !/\s/.test(text[index - 1]!))) continue;
    const match = /^@([A-Za-z]+)\b/.exec(text.slice(index));
    if (match === null) continue;
    tags.push({ name: match[1]!, start: index, end: index + match[0].length });
    expression = match[1] === 'middleware' || match[1] === 'Input';
    index += match[0].length - 1;
  }
  return tags;
}

function functionAnnotations(
  source: string,
  comments: readonly AstComment[],
  binding: FunctionBinding,
  names: ReadonlySet<string>,
  moduleId: string,
): { method?: ServerFunctionMethod; middleware?: string; input?: string } {
  const start = nodeStart(binding.declaration);
  const comment = [...comments].reverse().find(candidate =>
    candidate.end <= start && source.slice(candidate.end, start).trim() === '');
  if (comment?.type !== 'Block' || !comment.value.startsWith('*')) return {};
  const text = comment.value.replace(/^\s*\* ?/gm, '').trim();
  const tags = annotationTags(text);
  const result: { method?: ServerFunctionMethod; middleware?: string; input?: string } = {};
  for (let index = 0; index < tags.length; index++) {
    const match = tags[index]!;
    const tag = match.name;
    const value = text.slice(match.end, tags[index + 1]?.start).trim();
    const isMethod = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(tag);
    if (!isMethod && tag !== 'middleware' && tag !== 'Input') continue;
    const key = isMethod ? 'method' : tag === 'Input' ? 'input' : 'middleware';
    if (result[key] !== undefined) {
      throw compilerError(`memo-dom: [MMD-S014] duplicate server-function @${tag} annotation`, moduleId, binding.declaration);
    }
    if (isMethod) result.method = tag as ServerFunctionMethod;
    else {
      annotationExpression(value, tag, names, moduleId, binding.declaration);
      result[key as 'input' | 'middleware'] = value;
    }
  }
  if (Object.keys(result).length > 0) {
    const declaration = record(binding.declaration).declaration as BaseNode | undefined;
    const variable = declaration ?? binding.declaration;
    if (variable.type === 'VariableDeclaration' && (record(variable).declarations as unknown[]).length !== 1) {
      throw compilerError('memo-dom: [MMD-S014] annotated server functions need their own declaration', moduleId, binding.declaration);
    }
  }
  return result;
}

function exportedLocals(program: t.Program): Array<{
  exported: string;
  local: string;
  at: BaseNode;
}> {
  const exports: Array<{ exported: string; local: string; at: BaseNode }> = [];
  for (const statement of program.body) {
    if (astFactory.isExportDefaultDeclaration(statement)) {
      throw compilerError(
        'memo-dom: [MMD-S003] server/functions modules use named exports; default exports cannot cross the client boundary',
        undefined,
        statement as unknown as BaseNode,
      );
    }
    if (!astFactory.isExportNamedDeclaration(statement)) continue;
    if (record(statement as unknown as BaseNode).exportKind === 'type') continue;
    if (statement.source !== null) {
      throw compilerError(
        'memo-dom: [MMD-S003] re-export server functions through a local named binding so their endpoint and middleware ownership stay explicit',
        undefined,
        statement as unknown as BaseNode,
      );
    }
    const declaration = statement.declaration;
    if (
      astFactory.isFunctionDeclaration(declaration) &&
      declaration.id !== null
    ) {
      exports.push({
        exported: declaration.id.name,
        local: declaration.id.name,
        at: declaration.id as unknown as BaseNode,
      });
    } else if (astFactory.isVariableDeclaration(declaration)) {
      for (const item of declaration.declarations) {
        if (!astFactory.isIdentifier(item.id)) continue;
        exports.push({
          exported: item.id.name,
          local: item.id.name,
          at: item.id as unknown as BaseNode,
        });
      }
    }
    for (const specifier of statement.specifiers) {
      if (!astFactory.isExportSpecifier(specifier)) continue;
      const exported = astFactory.isIdentifier(specifier.exported)
        ? specifier.exported.name
        : specifier.exported.value;
      exports.push({
        exported,
        local: specifier.local.name,
        at: specifier as unknown as BaseNode,
      });
    }
  }
  return exports;
}

function typeNode(identifier: t.Identifier): BaseNode | null {
  const annotation = record(identifier as unknown as BaseNode).typeAnnotation;
  if (
    annotation === null ||
    typeof annotation !== 'object' ||
    !('type' in annotation)
  ) return null;
  const nested = record(annotation as BaseNode).typeAnnotation;
  return nested !== null && typeof nested === 'object' && 'type' in nested
    ? nested as BaseNode
    : null;
}

function literalQueryKind(node: BaseNode): Exclude<ServerFunctionQueryKind,
  'string[]' | 'number[]' | 'boolean[]'> | null {
  if (node.type === 'TSStringKeyword') return 'string';
  if (node.type === 'TSNumberKeyword') return 'number';
  if (node.type === 'TSBooleanKeyword') return 'boolean';
  if (node.type !== 'TSLiteralType') return null;
  const literal = record(node).literal;
  if (literal === null || typeof literal !== 'object' || !('type' in literal)) {
    return null;
  }
  const value = record(literal as BaseNode).value;
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return null;
}

function queryKindFromType(node: BaseNode | null): ServerFunctionQueryKind | null {
  if (node === null) return null;
  const scalar = literalQueryKind(node);
  if (scalar !== null) return scalar;
  if (node.type === 'TSArrayType') {
    const element = record(node).elementType;
    if (element === null || typeof element !== 'object' || !('type' in element)) {
      return null;
    }
    const item = literalQueryKind(element as BaseNode);
    return item === null ? null : `${item}[]`;
  }
  if (node.type === 'TSUnionType') {
    const values = record(node).types;
    if (!Array.isArray(values)) return null;
    const kinds = new Set<ServerFunctionQueryKind>();
    for (const value of values) {
      if (value === null || typeof value !== 'object' || !('type' in value)) {
        return null;
      }
      const type = value as BaseNode;
      if (type.type === 'TSUndefinedKeyword' || type.type === 'TSNullKeyword') {
        continue;
      }
      const kind = queryKindFromType(type);
      if (kind === null) return null;
      kinds.add(kind);
    }
    return kinds.size === 1 ? [...kinds][0]! : null;
  }
  return null;
}

function inferredDefaultKind(value: t.Expression): ServerFunctionQueryKind | null {
  if (astFactory.isStringLiteral(value)) return 'string';
  if (astFactory.isNumericLiteral(value)) return 'number';
  if (astFactory.isBooleanLiteral(value)) return 'boolean';
  return null;
}

function parametersFor(
  fn: FunctionBinding['node'],
  method: ServerFunctionMethod,
  moduleId: string,
): ServerFunctionParameter[] {
  return fn.params.map((rawParameter) => {
    const defaulted = astFactory.isAssignmentPattern(rawParameter);
    const parameter = defaulted ? rawParameter.left : rawParameter;
    if (!astFactory.isIdentifier(parameter)) {
      throw compilerError(
        'memo-dom: [MMD-S013] server function parameters must be named identifiers so the HTTP query/body contract is stable',
        moduleId,
        rawParameter as unknown as BaseNode,
      );
    }
    const optional = defaulted ||
      record(parameter as unknown as BaseNode).optional === true;
    if (method !== 'GET') return { name: parameter.name, optional };
    const annotation = typeNode(parameter);
    const queryKind = annotation === null
      ? (defaulted ? inferredDefaultKind(rawParameter.right) : null) ?? 'string'
      : queryKindFromType(annotation);
    if (queryKind === null) {
      throw compilerError(
        `memo-dom: [MMD-S003] GET server function parameter '${parameter.name}' must use one string, number, or boolean query type; received '${annotation?.type ?? 'unknown'}'`,
        moduleId,
        parameter as unknown as BaseNode,
      );
    }
    return { name: parameter.name, optional, queryKind };
  });
}

export function analyzeServerFunctionModule(
  source: string,
  options: AnalyzeServerFunctionOptions,
): ServerFunctionModule {
  const frontend = options.frontend ?? memoizedEstreeFrontend;
  const parsed = parseWithEstreeFrontendOrThrow(frontend, source, {
    filename: options.moduleId,
    sourceType: 'module',
  });
  const program = parsed.program as unknown as t.Program;
  const moduleName = serverFunctionModuleName(
    options.moduleId,
    options.functionsRoot,
  );
  const bindings = functionBindings(program);
  const names = moduleBindings(program);
  if (names.has(serverFunctionMetadataExport)) {
    throw compilerError(`memo-dom: [MMD-S014] '${serverFunctionMetadataExport}' is reserved for generated server metadata`, options.moduleId);
  }
  const functions: ServerFunctionDefinition[] = [];
  let middlewareExport = false;

  for (const exported of exportedLocals(program)) {
    if (exported.exported === serverFunctionMetadataExport) {
      throw compilerError(`memo-dom: [MMD-S014] '${serverFunctionMetadataExport}' is reserved for generated server metadata`, options.moduleId, exported.at);
    }
    if (exported.exported === 'middleware') {
      middlewareExport = true;
      continue;
    }
    const binding = bindings.get(exported.local);
    if (binding === undefined) {
      throw compilerError(
        `memo-dom: [MMD-S003] Server function module export '${exported.exported}' must be an async function; only annotated async functions and 'middleware' may cross the client boundary`,
        options.moduleId,
        exported.at,
      );
    }
    const annotations = functionAnnotations(source, parsed.comments, binding, names, options.moduleId);
    const method = annotations.method;
    if (method === undefined) {
      throw compilerError(
        `memo-dom: [MMD-S011] Server function '${exported.exported}' needs @GET, @POST, @PUT, @PATCH, or @DELETE`,
        options.moduleId,
        exported.at,
      );
    }
    if (!binding.node.async || binding.node.generator) {
      throw compilerError(
        `memo-dom: [MMD-S003] Server function '${exported.exported}' must be async before it can cross the client boundary`,
        options.moduleId,
        exported.at,
      );
    }
    if (moduleName === '') {
      throw compilerError(
        'memo-dom: server/functions root cannot contain endpoints; place functions in a named module',
        options.moduleId,
        exported.at,
      );
    }
    functions.push({
      exported: exported.exported,
      local: binding.local,
      method,
      path: `/_fn/${moduleName}/${encodeURIComponent(exported.exported)}`,
      parameters: parametersFor(binding.node, method, options.moduleId),
      ...(annotations.middleware === undefined ? {} : { middleware: annotations.middleware }),
      ...(annotations.input === undefined ? {} : { input: annotations.input }),
    });
  }

  return {
    moduleId: options.moduleId,
    moduleName,
    middlewareExport,
    functions: functions.sort((left, right) =>
      left.path.localeCompare(right.path)),
  };
}

/** Append metadata where private schema and middleware bindings remain accessible. */
export function generateServerFunctionImplementation(
  source: string,
  options: AnalyzeServerFunctionOptions,
): string {
  const module = analyzeServerFunctionModule(source, options);
  const entries = module.functions
    .filter(fn => fn.middleware !== undefined || fn.input !== undefined)
    .map(fn => `[${JSON.stringify(fn.exported)}]: { middleware: ${fn.middleware ?? '[]'}${fn.input === undefined ? '' : `, input: ${fn.input}`} }`);
  if (entries.length === 0) return source;
  return `${source}\nexport const ${serverFunctionMetadataExport} = {\n${entries.join(',\n')}\n};\n`;
}

export function generateServerFunctionClient(
  module: ServerFunctionModule,
  dataModule = '@memoized-dom/data',
): string {
  const lines = [`import { $fetch as __mmd_fetch } from ${JSON.stringify(dataModule)};`];
  for (const fn of module.functions) {
    const parameters = fn.parameters.map(parameter => parameter.name).join(', ');
    const entries = fn.parameters.map(parameter => parameter.name).join(', ');
    if (fn.method === 'GET') {
      const options = fn.parameters.length === 0
        ? ''
        : `, { query: { ${entries} } }`;
      lines.push(
        `export function ${fn.exported}(${parameters}) { return __mmd_fetch(${JSON.stringify(fn.path)}${options}); }`,
      );
    } else {
      const body = fn.parameters.length === 0 ? '' : `, body: { ${entries} }`;
      lines.push(
        `export function ${fn.exported}(${parameters}) { return __mmd_fetch(${JSON.stringify(fn.path)}, { method: ${JSON.stringify(fn.method)}${body} }); }`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

export interface ServerFunctionDeclarationOptions {
  /**
   * Resolves each analyzed module id to the specifier the generated file uses
   * to type-import its real implementation. Type-only, so it erases at runtime
   * and never pulls the server dependency graph into a client build.
   */
  readonly resolveImplementation: (moduleId: string) => string;
  readonly dataModule?: string;
}

/**
 * Emit the client-facing declaration barrel for the application's server
 * functions. Signatures reference the real implementations through
 * `Parameters`/`ReturnType`, so server builds keep their ordinary async
 * TypeScript types while client imports see the colorless `ResolvedValue<T>`
 * contract (readable as `T`, `$track`-able). Exported names must be unique
 * across modules because the barrel is one flat module.
 */
export function generateServerFunctionDeclarations(
  modules: readonly ServerFunctionModule[],
  options: ServerFunctionDeclarationOptions,
): string {
  const lines = [
    '// Generated by @memoized-dom/compiler — client facade declarations for the application server functions.',
    `import type { ResolvedValue } from ${JSON.stringify(options.dataModule ?? '@memoized-dom/data')};`,
    `import type { JsonResponse, ErrorResponse } from '@memoized-dom/server';`,
    'type __mmdClientValue<T> = T extends ErrorResponse ? never : T extends JsonResponse<infer U> ? U : T extends Response ? unknown : T;',
  ];
  const seen = new Map<string, string>();
  const statements: string[] = [];
  let aliasIndex = 0;
  for (const module of modules) {
    if (module.functions.length === 0) continue;
    const alias = `__mmd_impl_${aliasIndex++}`;
    lines.push(
      `import type * as ${alias} from ${JSON.stringify(options.resolveImplementation(module.moduleId))};`,
    );
    for (const fn of module.functions) {
      const owner = seen.get(fn.exported);
      if (owner !== undefined) {
        throw compilerError(
          `memo-dom: [MMD-S012] server function name '${fn.exported}' is exported by both '${owner}' and '${module.moduleId}'; the '#server-functions' barrel requires unique exported names`,
          module.moduleId,
        );
      }
      seen.set(fn.exported, module.moduleId);
      const target = `${alias}.${fn.exported}`;
      statements.push(
        `export declare function ${fn.exported}(...args: Parameters<typeof ${target}>): ResolvedValue<__mmdClientValue<Awaited<ReturnType<typeof ${target}>>>>;`,
      );
    }
  }
  return `${[...lines, ...statements].join('\n')}\n`;
}
