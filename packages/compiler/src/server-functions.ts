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

function methodFromName(name: string): ServerFunctionMethod | null {
  if (name.startsWith('get')) return 'GET';
  if (name.startsWith('post')) return 'POST';
  if (name.startsWith('put')) return 'PUT';
  if (name.startsWith('patch')) return 'PATCH';
  if (name.startsWith('delete')) return 'DELETE';
  return null;
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
        functions.set(item.id.name, { local: item.id.name, node: init });
      }
    }
  }
  return functions;
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
    const queryKind = queryKindFromType(typeNode(parameter)) ??
      (defaulted ? inferredDefaultKind(rawParameter.right) : null) ??
      'string';
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
  const functions: ServerFunctionDefinition[] = [];
  let middlewareExport = false;

  for (const exported of exportedLocals(program)) {
    if (exported.exported === 'middleware') {
      middlewareExport = true;
      continue;
    }
    const binding = bindings.get(exported.local);
    if (binding === undefined) {
      throw compilerError(
        `memo-dom: [MMD-S003] Server function module export '${exported.exported}' must be an async function; only verb-prefixed async functions and 'middleware' may cross the client boundary`,
        options.moduleId,
        exported.at,
      );
    }
    const method = methodFromName(exported.exported);
    if (method === null) {
      throw compilerError(
        `memo-dom: [MMD-S011] Server function '${exported.exported}' must begin with get, post, put, patch, or delete`,
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
    `import type { JsonResponse } from '@memoized-dom/server';`,
    'type __mmdClientValue<T> = T extends JsonResponse<infer U> ? U : T extends Response ? unknown : T;',
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
