/**
 * Compiler-owned JSX routing analysis.
 *
 * `route` and `route-to` are universal compiler properties. They are removed
 * before ordinary JSX prop analysis, leaving no DOM attributes or component
 * props behind.
 */

import type * as t from './ast/compiler-types';
import * as astFactory from './ast/factory';
import { cloneNode as cloneEstreeNode } from './ast';
import {
  ESTREE_VISITOR_KEYS,
  childNode,
  childNodes,
  nodeFields as fields,
  stringValue,
  walkAst,
  type BaseNode,
} from './ast';
import type { Ctx } from './context';
import { generatedIdentifier, mr } from './identifiers';
import { jsxAttributeName } from './jsx/attributes';

const PARAMETER_SEGMENT = /^:([A-Za-z_$][A-Za-z0-9_$]*)$/;

export interface CompilerRouteDefinition {
  readonly id: string;
  readonly moduleId: string;
  readonly pattern: string;
  readonly fullPattern: string;
  readonly parentId?: string;
  readonly line?: number;
  readonly column?: number;
}

export interface CompilerRouteElement extends CompilerRouteDefinition {}

interface RouteToTarget {
  readonly path: string;
  readonly options: t.ObjectExpression | null;
}

interface ProgramContainer {
  node: t.Program;
  buildCodeFrameError(message: string, at?: t.Node): Error;
}

interface DiagnosticNode<TNode> {
  node: TNode;
  buildCodeFrameError(message: string): Error;
}

function attributeNamed(
  element: t.JSXElement,
  name: string,
): t.JSXAttribute | undefined {
  return element.openingElement.attributes.find(
    (attribute): attribute is t.JSXAttribute =>
      astFactory.isJSXAttribute(attribute) &&
      jsxAttributeName(attribute.name) === name,
  );
}

function staticAttributeString(attribute: t.JSXAttribute): string | null {
  const value = attribute.value as unknown as BaseNode | null;
  if (value?.type === 'JSXExpressionContainer') {
    return stringValue(childNode(value, 'expression'));
  }
  return stringValue(value);
}

function routeId(
  moduleId: string,
  node: t.JSXElement,
  fallback: number,
): string {
  const line = node.openingElement.loc?.start.line;
  const column = node.openingElement.loc?.start.column;
  return line === undefined || column === undefined
    ? `${moduleId}#route:${fallback}`
    : `${moduleId}#route:${line}:${column}`;
}

function pathSegments(pattern: string): string[] {
  return pattern.split('/').filter(Boolean);
}

export function validateCompilerRoutePattern(pattern: string): string {
  if (!pattern.startsWith('/')) {
    throw new TypeError(`route pattern '${pattern}' must begin with '/'`);
  }
  if (pattern.includes('?') || pattern.includes('#')) {
    throw new TypeError(`route pattern '${pattern}' must not contain a query or hash`);
  }
  if (pattern.includes('//')) {
    throw new TypeError(`route pattern '${pattern}' contains an empty path segment`);
  }

  const trimmed = pattern.replace(/\/+$/g, '');
  const normalized = trimmed === '' ? '/' : trimmed;
  const parameters = new Set<string>();
  const segments = pathSegments(normalized);
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    if (segment === '*') {
      if (index !== segments.length - 1) {
        throw new TypeError(`route wildcard must be terminal in '${pattern}'`);
      }
      continue;
    }
    if (!segment.startsWith(':')) continue;
    const match = PARAMETER_SEGMENT.exec(segment);
    if (match === null) {
      throw new TypeError(`invalid route parameter segment '${segment}' in '${pattern}'`);
    }
    const name = match[1]!;
    if (parameters.has(name)) {
      throw new TypeError(`duplicate route parameter '${name}' in '${pattern}'`);
    }
    parameters.add(name);
  }
  return normalized;
}

function routeParameterNames(pattern: string): string[] {
  const names: string[] = [];
  for (const segment of pathSegments(pattern)) {
    if (segment === '*') names.push('*');
    else if (segment.startsWith(':')) names.push(segment.slice(1));
  }
  return names;
}

function joinRoutePattern(parent: string, child: string): string {
  if (parent.endsWith('/*')) {
    throw new TypeError(`catch-all route '${parent}' cannot have child routes`);
  }
  if (child === '/') return parent;
  return parent === '/' ? child : `${parent}${child}`;
}

function collectDefinitionsFromNode(
  root: BaseNode,
  moduleId: string,
): CompilerRouteDefinition[] {
  const definitions: CompilerRouteDefinition[] = [];
  let fallback = 0;

  const visit = (
    currentNode: BaseNode,
    ancestor: CompilerRouteDefinition | null,
  ): void => {
    if (currentNode.type === 'JSXElement') {
      const element = currentNode as unknown as t.JSXElement;
      let current = ancestor;
      const attribute = attributeNamed(element, 'route');
      if (attribute !== undefined) {
        const raw = staticAttributeString(attribute);
        if (raw !== null) {
          const pattern = validateCompilerRoutePattern(raw);
          const fullPattern = ancestor === null
            ? pattern
            : joinRoutePattern(ancestor.fullPattern, pattern);
          const inherited = new Set(
            ancestor === null ? [] : routeParameterNames(ancestor.fullPattern),
          );
          for (const name of routeParameterNames(pattern)) {
            if (inherited.has(name)) {
              throw new TypeError(
                `route '${fullPattern}' shadows active parameter '${name}'`,
              );
            }
          }
          current = {
            id: routeId(moduleId, element, fallback++),
            moduleId,
            pattern,
            fullPattern,
            ...(ancestor === null ? {} : { parentId: ancestor.id }),
            ...(element.openingElement.loc?.start.line === undefined
              ? {}
              : { line: element.openingElement.loc.start.line }),
            ...(element.openingElement.loc?.start.column === undefined
              ? {}
              : { column: element.openingElement.loc.start.column }),
          };
          definitions.push(current);
        }
      }
      // JSX may also live in a render-prop expression. Full traversal sees it
      // and lexical nearest-ancestor routing must agree with this graph-only
      // collection pass used by compileModules/diagnostics.
      for (const attribute of element.openingElement.attributes) {
        visit(attribute as unknown as BaseNode, current);
      }
      for (const child of element.children) {
        visit(child as unknown as BaseNode, current);
      }
      return;
    }
    if (currentNode.type === 'JSXFragment') {
      for (const child of childNodes(currentNode, 'children')) {
        visit(child, ancestor);
      }
      return;
    }
    for (const key of ESTREE_VISITOR_KEYS[currentNode.type] ?? []) {
      const value = fields(currentNode)[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child !== null && typeof child === 'object' && 'type' in child) {
            visit(child as BaseNode, ancestor);
          }
        }
      } else if (value !== null && typeof value === 'object' && 'type' in value) {
        visit(value as BaseNode, ancestor);
      }
    }
  };

  visit(root, null);
  return definitions;
}

export function collectCompilerRoutes(
  root: t.File | t.Program,
  moduleId: string,
): CompilerRouteDefinition[] {
  const program = root.type === 'File' ? root.program : root;
  return collectDefinitionsFromNode(program as unknown as BaseNode, moduleId);
}

function routeSignature(pattern: string): string {
  return pathSegments(pattern)
    .map((segment) => segment === '*' ? '*' : segment.startsWith(':') ? ':param' : segment)
    .join('/');
}

function isRouteAncestor(
  ancestor: CompilerRouteDefinition,
  descendant: CompilerRouteDefinition,
  byId: ReadonlyMap<string, CompilerRouteDefinition>,
): boolean {
  let parentId = descendant.parentId;
  while (parentId !== undefined) {
    if (parentId === ancestor.id) return true;
    parentId = byId.get(parentId)?.parentId;
  }
  return false;
}

export function validateCompilerRouteGraph(
  definitions: readonly CompilerRouteDefinition[],
): void {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const signatures = new Map<string, CompilerRouteDefinition>();
  for (const definition of definitions) {
    if (definition.parentId !== undefined && !byId.has(definition.parentId)) {
      throw new TypeError(
        `route '${definition.fullPattern}' references a missing compiler parent`,
      );
    }
    const signature = routeSignature(definition.fullPattern);
    const existing = signatures.get(signature);
    if (
      existing !== undefined &&
      !isRouteAncestor(existing, definition, byId) &&
      !isRouteAncestor(definition, existing, byId)
    ) {
      throw new TypeError(
        `ambiguous routes '${existing.fullPattern}' and '${definition.fullPattern}' share '${signature}'`,
      );
    }
    signatures.set(signature, definition);
  }
}

function propertyName(property: t.ObjectProperty): string | null {
  if (!property.computed && astFactory.isIdentifier(property.key)) return property.key.name;
  if (astFactory.isStringLiteral(property.key)) return property.key.value;
  return null;
}

function routeToTarget(
  attributePath: DiagnosticNode<t.JSXAttribute>,
  knownRoutes: ReadonlyMap<string, CompilerRouteDefinition>,
): RouteToTarget {
  const attribute = attributePath.node;
  const direct = staticAttributeString(attribute);
  let path: string;
  let options: t.ObjectExpression | null = null;

  if (direct !== null) {
    try {
      path = validateCompilerRoutePattern(direct);
    } catch (error) {
      throw attributePath.buildCodeFrameError(`memo-dom: ${(error as Error).message}`);
    }
  } else if (
    astFactory.isJSXExpressionContainer(attribute.value) &&
    astFactory.isObjectExpression(attribute.value.expression)
  ) {
    const object = attribute.value.expression;
    if (object.properties.some((property) => astFactory.isSpreadElement(property))) {
      throw attributePath.buildCodeFrameError(
        'memo-dom: route-to objects must have statically known keys; object spreads are not supported',
      );
    }
    const entries = new Map<string, t.ObjectProperty>();
    for (const property of object.properties) {
      if (!astFactory.isObjectProperty(property)) continue;
      const name = propertyName(property);
      if (name === null) {
        throw attributePath.buildCodeFrameError(
          'memo-dom: route-to object keys must be static',
        );
      }
      if (entries.has(name)) {
        throw attributePath.buildCodeFrameError(
          `memo-dom: route-to contains duplicate '${name}' fields`,
        );
      }
      entries.set(name, property);
    }
    const allowed = new Set(['path', 'params', 'query', 'hash', 'replace']);
    for (const name of entries.keys()) {
      if (!allowed.has(name)) {
        throw attributePath.buildCodeFrameError(
          `memo-dom: route-to does not support '${name}'`,
        );
      }
    }
    const pathProperty = entries.get('path');
    if (pathProperty === undefined || !astFactory.isStringLiteral(pathProperty.value)) {
      throw attributePath.buildCodeFrameError(
        "memo-dom: route-to requires a static string 'path'",
      );
    }
    try {
      path = validateCompilerRoutePattern(pathProperty.value.value);
    } catch (error) {
      throw attributePath.buildCodeFrameError(`memo-dom: ${(error as Error).message}`);
    }
    options = astFactory.objectExpression(
      object.properties
        .filter(
          (property): property is t.ObjectProperty =>
            astFactory.isObjectProperty(property) && propertyName(property) !== 'path',
        )
        .map((property) => cloneEstreeNode(property, true)),
    );

    const expected = routeParameterNames(path);
    const params = entries.get('params');
    if (expected.length > 0 && params === undefined) {
      throw attributePath.buildCodeFrameError(
        `memo-dom: route-to '${path}' requires params { ${expected.join(', ')} }`,
      );
    }
    if (params !== undefined) {
      if (!astFactory.isObjectExpression(params.value)) {
        throw attributePath.buildCodeFrameError(
          'memo-dom: route-to params must be an object literal with static keys',
        );
      }
      if (params.value.properties.some((property) => astFactory.isSpreadElement(property))) {
        throw attributePath.buildCodeFrameError(
          'memo-dom: route-to params do not support object spreads',
        );
      }
      const actual = params.value.properties.map((property) => {
        if (!astFactory.isObjectProperty(property)) return null;
        return propertyName(property);
      });
      if (actual.some((name) => name === null)) {
        throw attributePath.buildCodeFrameError(
          'memo-dom: route-to param names must be static',
        );
      }
      const actualNames = actual as string[];
      const duplicate = actualNames.find(
        (name, index) => actualNames.indexOf(name) !== index,
      );
      if (duplicate !== undefined) {
        throw attributePath.buildCodeFrameError(
          `memo-dom: route-to params contain duplicate '${duplicate}'`,
        );
      }
      const missing = expected.filter((name) => !actualNames.includes(name));
      const extra = actualNames.filter((name) => !expected.includes(name));
      if (missing.length > 0 || extra.length > 0) {
        throw attributePath.buildCodeFrameError(
          `memo-dom: route-to '${path}' params mismatch` +
            (missing.length === 0 ? '' : `; missing ${missing.join(', ')}`) +
            (extra.length === 0 ? '' : `; unknown ${extra.join(', ')}`),
        );
      }
    }
  } else {
    throw attributePath.buildCodeFrameError(
      'memo-dom: route-to must be a static route string or a statically shaped destination object',
    );
  }

  const definition = knownRoutes.get(path);
  if (definition === undefined) {
    throw attributePath.buildCodeFrameError(
      `memo-dom: route-to references undeclared route '${path}'`,
    );
  }
  const required = routeParameterNames(definition.fullPattern);
  if (direct !== null && required.length > 0) {
    throw attributePath.buildCodeFrameError(
      `memo-dom: route-to '${path}' requires params { ${required.join(', ')} }; use the object form`,
    );
  }
  return { path, options };
}

function buildRouteHref(ctx: Ctx, target: RouteToTarget): t.Expression {
  if (target.options === null) return astFactory.stringLiteral(target.path);
  const values = new Map<string, t.Expression>();
  for (const property of target.options.properties) {
    if (!astFactory.isObjectProperty(property) || !astFactory.isExpression(property.value)) continue;
    const name = propertyName(property);
    if (name !== null) values.set(name, property.value);
  }
  const value = (name: string): t.Expression =>
    cloneEstreeNode(values.get(name) ?? astFactory.identifier('undefined'), true);
  return astFactory.callExpression(mr(ctx, 'buildRoutePath'), [
    astFactory.stringLiteral(target.path),
    value('params'),
    value('query'),
    value('hash'),
  ]);
}

function navigateExpression(ctx: Ctx, target: RouteToTarget): t.CallExpression {
  return astFactory.callExpression(mr(ctx, 'navigateRoute'), [
    astFactory.stringLiteral(target.path),
    ...(target.options === null ? [] : [cloneEstreeNode(target.options, true)]),
  ]);
}

function installRouteTo(
  ctx: Ctx,
  element: t.JSXElement,
  attributePath: DiagnosticNode<t.JSXAttribute>,
  target: RouteToTarget,
): void {
  const opening = element.openingElement;
  if (!astFactory.isJSXIdentifier(opening.name)) {
    throw attributePath.buildCodeFrameError(
      'memo-dom: route-to currently requires a statically named JSX element',
    );
  }
  const tag = opening.name.name;
  if (/^[A-Z]/.test(tag)) {
    throw attributePath.buildCodeFrameError(
      'memo-dom: route-to currently targets intrinsic elements; put it on the interactive host rendered by this component',
    );
  }
  if (opening.attributes.some((attribute) => astFactory.isJSXSpreadAttribute(attribute))) {
    throw attributePath.buildCodeFrameError(
      'memo-dom: route-to cannot be combined with JSX prop spreads because navigation ownership must be static',
    );
  }

  if (tag === 'a') {
    if (attributeNamed(element, 'href') !== undefined) {
      throw attributePath.buildCodeFrameError(
        'memo-dom: an anchor using route-to must not also declare href',
      );
    }
    const href = buildRouteHref(ctx, target);
    opening.attributes.push(
      astFactory.jsxAttribute(
        astFactory.jsxIdentifier('href'),
        astFactory.isStringLiteral(href)
          ? href
          : astFactory.jsxExpressionContainer(href),
      ),
    );
    return;
  }

  const click = attributeNamed(element, 'onClick');
  const event = generatedIdentifier(ctx, 'routeEvent');
  const statements: t.Statement[] = [];
  let result: t.Identifier | null = null;
  if (click !== undefined) {
    let handler: t.Expression | null = null;
    if (
      astFactory.isJSXExpressionContainer(click.value) &&
      astFactory.isExpression(click.value.expression)
    ) {
      handler = click.value.expression;
    }
    if (handler === null) {
      throw attributePath.buildCodeFrameError(
        'memo-dom: onClick used with route-to must contain a handler expression',
      );
    }
    result = generatedIdentifier(ctx, 'routeClickResult');
    statements.push(
      astFactory.variableDeclaration('const', [
        astFactory.variableDeclarator(
          cloneEstreeNode(result),
          astFactory.callExpression(cloneEstreeNode(handler, true), [cloneEstreeNode(event)]),
        ),
      ]),
    );
    opening.attributes = opening.attributes.filter((attribute) => attribute !== click);
  }
  statements.push(
    astFactory.ifStatement(
      astFactory.unaryExpression(
        '!',
        astFactory.memberExpression(cloneEstreeNode(event), astFactory.identifier('defaultPrevented')),
      ),
      astFactory.expressionStatement(navigateExpression(ctx, target)),
    ),
  );
  if (result !== null) statements.push(astFactory.returnStatement(cloneEstreeNode(result)));
  opening.attributes.push(
    astFactory.jsxAttribute(
      astFactory.jsxIdentifier('onClick'),
      astFactory.jsxExpressionContainer(
        astFactory.arrowFunctionExpression(
          [cloneEstreeNode(event)],
          astFactory.blockStatement(statements),
        ),
      ),
    ),
  );
}

/** Analyze, validate, and erase compiler-owned route properties. */
export function analyzeRouterJsx(
  ctx: Ctx,
  programPath: ProgramContainer,
): void {
  const localDefinitions: CompilerRouteDefinition[] = [];
  let fallback = 0;
  const routeAncestors: Array<CompilerRouteElement | null> = [];
  const program = programPath.node as unknown as BaseNode;
  walkAst<BaseNode>(program, {
    enter(current) {
      if (current.type !== 'JSXElement') return;
      const element = current as unknown as t.JSXElement;
      const parent = routeAncestors.at(-1) ?? null;
      let active = parent;
      const attribute = attributeNamed(element, 'route');
      if (attribute === undefined) {
        routeAncestors.push(active);
        return;
      }
      const diagnostic: DiagnosticNode<t.JSXAttribute> = {
        node: attribute,
        buildCodeFrameError(message) {
          return programPath.buildCodeFrameError(message, attribute);
        },
      };
      const raw = staticAttributeString(attribute);
      if (raw === null) {
        throw diagnostic.buildCodeFrameError(
          'memo-dom: route must be a static string beginning with /',
        );
      }
      let pattern: string;
      try {
        pattern = validateCompilerRoutePattern(raw);
      } catch (error) {
        throw diagnostic.buildCodeFrameError(`memo-dom: ${(error as Error).message}`);
      }
      let fullPattern: string;
      try {
        fullPattern = parent === null
          ? pattern
          : joinRoutePattern(parent.fullPattern, pattern);
      } catch (error) {
        throw diagnostic.buildCodeFrameError(`memo-dom: ${(error as Error).message}`);
      }
      const inherited = new Set(
        parent === null ? [] : routeParameterNames(parent.fullPattern),
      );
      for (const name of routeParameterNames(pattern)) {
        if (inherited.has(name)) {
          throw diagnostic.buildCodeFrameError(
            `memo-dom: route '${fullPattern}' shadows active parameter '${name}'`,
          );
        }
      }
      const definition: CompilerRouteElement = {
        id: routeId(ctx.moduleId, element, fallback++),
        moduleId: ctx.moduleId,
        pattern,
        fullPattern,
        ...(parent === null ? {} : { parentId: parent.id }),
        ...(element.openingElement.loc?.start.line === undefined
          ? {}
          : { line: element.openingElement.loc.start.line }),
        ...(element.openingElement.loc?.start.column === undefined
          ? {}
          : { column: element.openingElement.loc.start.column }),
      };
      ctx.routeElements.set(element, definition);
      localDefinitions.push(definition);
      ctx.localRoutes.push(definition);
      ctx.usesRouter = true;
      element.openingElement.attributes = element.openingElement.attributes.filter(
        (candidate) => candidate !== attribute,
      );
      active = definition;
      routeAncestors.push(active);
    },
    leave(current) {
      if (current.type === 'JSXElement') routeAncestors.pop();
    },
  });

  const definitions = ctx.linkedRoutes ?? localDefinitions;
  validateCompilerRouteGraph(definitions);
  const knownRoutes = new Map(
    definitions.map((definition) => [definition.fullPattern, definition]),
  );

  walkAst<BaseNode>(program, {
    enter(current) {
      if (current.type !== 'JSXElement') return;
      const element = current as unknown as t.JSXElement;
      const attribute = attributeNamed(element, 'route-to');
      if (attribute === undefined) return;
      const diagnostic: DiagnosticNode<t.JSXAttribute> = {
        node: attribute,
        buildCodeFrameError(message) {
          return programPath.buildCodeFrameError(message, attribute);
        },
      };
      const target = routeToTarget(diagnostic, knownRoutes);
      ctx.usesRouter = true;
      element.openingElement.attributes = element.openingElement.attributes.filter(
        (candidate) => candidate !== attribute,
      );
      installRouteTo(ctx, element, diagnostic, target);
    },
  });
}

export function routeManifestStatements(ctx: Ctx): t.Statement[] {
  if (!ctx.emitRouteManifest) return [];
  const definitions = ctx.linkedRoutes ?? ctx.localRoutes;
  if (definitions.length === 0) return [];
  ctx.usesRouter = true;
  const manifest = generatedIdentifier(ctx, 'routeManifest');
  return [
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        cloneEstreeNode(manifest),
        astFactory.callExpression(mr(ctx, 'createRouteManifest'), [
          astFactory.arrayExpression(
            definitions.map((definition) =>
              astFactory.objectExpression([
                astFactory.objectProperty(astFactory.identifier('id'), astFactory.stringLiteral(definition.id)),
                astFactory.objectProperty(astFactory.identifier('pattern'), astFactory.stringLiteral(definition.pattern)),
                ...(definition.parentId === undefined
                  ? []
                  : [
                      astFactory.objectProperty(
                        astFactory.identifier('parentId'),
                        astFactory.stringLiteral(definition.parentId),
                      ),
                    ]),
              ]),
            ),
          ),
        ]),
      ),
    ]),
    astFactory.expressionStatement(
      astFactory.callExpression(mr(ctx, 'replaceRouteResolver'), [
        astFactory.memberExpression(cloneEstreeNode(manifest), astFactory.identifier('resolve')),
      ]),
    ),
    astFactory.expressionStatement(astFactory.callExpression(mr(ctx, 'ensureRouterConnected'), [])),
  ];
}
