/**
 * Compiler-owned JSX routing analysis.
 *
 * `route` and `route-to` are universal compiler properties. They are removed
 * before ordinary JSX prop analysis, leaving no DOM attributes or component
 * props behind.
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
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

function attributeNamed(
  element: t.JSXElement,
  name: string,
): t.JSXAttribute | undefined {
  return element.openingElement.attributes.find(
    (attribute): attribute is t.JSXAttribute =>
      t.isJSXAttribute(attribute) &&
      jsxAttributeName(attribute.name) === name,
  );
}

function staticAttributeString(attribute: t.JSXAttribute): string | null {
  if (t.isStringLiteral(attribute.value)) return attribute.value.value;
  if (
    t.isJSXExpressionContainer(attribute.value) &&
    t.isStringLiteral(attribute.value.expression)
  ) {
    return attribute.value.expression.value;
  }
  return null;
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
  root: t.Node,
  moduleId: string,
): CompilerRouteDefinition[] {
  const definitions: CompilerRouteDefinition[] = [];
  let fallback = 0;

  const visit = (
    node: t.Node,
    ancestor: CompilerRouteDefinition | null,
  ): void => {
    if (t.isJSXElement(node)) {
      let current = ancestor;
      const attribute = attributeNamed(node, 'route');
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
            id: routeId(moduleId, node, fallback++),
            moduleId,
            pattern,
            fullPattern,
            ...(ancestor === null ? {} : { parentId: ancestor.id }),
            ...(node.openingElement.loc?.start.line === undefined
              ? {}
              : { line: node.openingElement.loc.start.line }),
            ...(node.openingElement.loc?.start.column === undefined
              ? {}
              : { column: node.openingElement.loc.start.column }),
          };
          definitions.push(current);
        }
      }
      // JSX may also live in a render-prop expression. Babel traversal sees it
      // and lexical nearest-ancestor routing must agree with this graph-only
      // collection pass used by compileModules/diagnostics.
      for (const attribute of node.openingElement.attributes) {
        visit(attribute, current);
      }
      for (const child of node.children) visit(child, current);
      return;
    }
    if (t.isJSXFragment(node)) {
      for (const child of node.children) visit(child, ancestor);
      return;
    }
    for (const key of t.VISITOR_KEYS[node.type] ?? []) {
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child !== null && typeof child === 'object' && 'type' in child) {
            visit(child as t.Node, ancestor);
          }
        }
      } else if (value !== null && typeof value === 'object' && 'type' in value) {
        visit(value as t.Node, ancestor);
      }
    }
  };

  visit(root, null);
  return definitions;
}

export function collectCompilerRoutes(
  file: t.File,
  moduleId: string,
): CompilerRouteDefinition[] {
  return collectDefinitionsFromNode(file.program, moduleId);
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
  if (!property.computed && t.isIdentifier(property.key)) return property.key.name;
  if (t.isStringLiteral(property.key)) return property.key.value;
  return null;
}

function routeToTarget(
  attributePath: NodePath<t.JSXAttribute>,
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
    t.isJSXExpressionContainer(attribute.value) &&
    t.isObjectExpression(attribute.value.expression)
  ) {
    const object = attribute.value.expression;
    if (object.properties.some((property) => t.isSpreadElement(property))) {
      throw attributePath.buildCodeFrameError(
        'memo-dom: route-to objects must have statically known keys; object spreads are not supported',
      );
    }
    const entries = new Map<string, t.ObjectProperty>();
    for (const property of object.properties) {
      if (!t.isObjectProperty(property)) continue;
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
    if (pathProperty === undefined || !t.isStringLiteral(pathProperty.value)) {
      throw attributePath.buildCodeFrameError(
        "memo-dom: route-to requires a static string 'path'",
      );
    }
    try {
      path = validateCompilerRoutePattern(pathProperty.value.value);
    } catch (error) {
      throw attributePath.buildCodeFrameError(`memo-dom: ${(error as Error).message}`);
    }
    options = t.objectExpression(
      object.properties
        .filter(
          (property): property is t.ObjectProperty =>
            t.isObjectProperty(property) && propertyName(property) !== 'path',
        )
        .map((property) => t.cloneNode(property, true)),
    );

    const expected = routeParameterNames(path);
    const params = entries.get('params');
    if (expected.length > 0 && params === undefined) {
      throw attributePath.buildCodeFrameError(
        `memo-dom: route-to '${path}' requires params { ${expected.join(', ')} }`,
      );
    }
    if (params !== undefined) {
      if (!t.isObjectExpression(params.value)) {
        throw attributePath.buildCodeFrameError(
          'memo-dom: route-to params must be an object literal with static keys',
        );
      }
      if (params.value.properties.some((property) => t.isSpreadElement(property))) {
        throw attributePath.buildCodeFrameError(
          'memo-dom: route-to params do not support object spreads',
        );
      }
      const actual = params.value.properties.map((property) => {
        if (!t.isObjectProperty(property)) return null;
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
  if (target.options === null) return t.stringLiteral(target.path);
  const values = new Map<string, t.Expression>();
  for (const property of target.options.properties) {
    if (!t.isObjectProperty(property) || !t.isExpression(property.value)) continue;
    const name = propertyName(property);
    if (name !== null) values.set(name, property.value);
  }
  const value = (name: string): t.Expression =>
    t.cloneNode(values.get(name) ?? t.identifier('undefined'), true);
  return t.callExpression(mr(ctx, 'buildRoutePath'), [
    t.stringLiteral(target.path),
    value('params'),
    value('query'),
    value('hash'),
  ]);
}

function navigateExpression(ctx: Ctx, target: RouteToTarget): t.CallExpression {
  return t.callExpression(mr(ctx, 'navigateRoute'), [
    t.stringLiteral(target.path),
    ...(target.options === null ? [] : [t.cloneNode(target.options, true)]),
  ]);
}

function installRouteTo(
  ctx: Ctx,
  elementPath: NodePath<t.JSXElement>,
  attributePath: NodePath<t.JSXAttribute>,
  target: RouteToTarget,
): void {
  const opening = elementPath.node.openingElement;
  if (!t.isJSXIdentifier(opening.name)) {
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
  if (opening.attributes.some((attribute) => t.isJSXSpreadAttribute(attribute))) {
    throw attributePath.buildCodeFrameError(
      'memo-dom: route-to cannot be combined with JSX prop spreads because navigation ownership must be static',
    );
  }

  if (tag === 'a') {
    if (attributeNamed(elementPath.node, 'href') !== undefined) {
      throw attributePath.buildCodeFrameError(
        'memo-dom: an anchor using route-to must not also declare href',
      );
    }
    const href = buildRouteHref(ctx, target);
    opening.attributes.push(
      t.jsxAttribute(
        t.jsxIdentifier('href'),
        t.isStringLiteral(href)
          ? href
          : t.jsxExpressionContainer(href),
      ),
    );
    return;
  }

  const click = attributeNamed(elementPath.node, 'onClick');
  const event = generatedIdentifier(ctx, 'routeEvent');
  const statements: t.Statement[] = [];
  let result: t.Identifier | null = null;
  if (click !== undefined) {
    let handler: t.Expression | null = null;
    if (
      t.isJSXExpressionContainer(click.value) &&
      t.isExpression(click.value.expression)
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
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.cloneNode(result),
          t.callExpression(t.cloneNode(handler, true), [t.cloneNode(event)]),
        ),
      ]),
    );
    opening.attributes = opening.attributes.filter((attribute) => attribute !== click);
  }
  statements.push(
    t.ifStatement(
      t.unaryExpression(
        '!',
        t.memberExpression(t.cloneNode(event), t.identifier('defaultPrevented')),
      ),
      t.expressionStatement(navigateExpression(ctx, target)),
    ),
  );
  if (result !== null) statements.push(t.returnStatement(t.cloneNode(result)));
  opening.attributes.push(
    t.jsxAttribute(
      t.jsxIdentifier('onClick'),
      t.jsxExpressionContainer(
        t.arrowFunctionExpression(
          [t.cloneNode(event)],
          t.blockStatement(statements),
        ),
      ),
    ),
  );
}

/** Analyze, validate, and erase compiler-owned route properties. */
export function analyzeRouterJsx(
  ctx: Ctx,
  programPath: NodePath<t.Program>,
): void {
  const localDefinitions: CompilerRouteDefinition[] = [];
  let fallback = 0;
  programPath.traverse({
    JSXElement(elementPath) {
      const attributePath = elementPath
        .get('openingElement')
        .get('attributes')
        .find(
          (candidate): candidate is NodePath<t.JSXAttribute> =>
            candidate.isJSXAttribute() &&
            jsxAttributeName(candidate.node.name) === 'route',
        );
      if (attributePath === undefined) return;
      const raw = staticAttributeString(attributePath.node);
      if (raw === null) {
        throw attributePath.buildCodeFrameError(
          'memo-dom: route must be a static string beginning with /',
        );
      }
      let pattern: string;
      try {
        pattern = validateCompilerRoutePattern(raw);
      } catch (error) {
        throw attributePath.buildCodeFrameError(`memo-dom: ${(error as Error).message}`);
      }
      const parentPath = elementPath.findParent(
        (candidate): candidate is NodePath<t.JSXElement> =>
          candidate.isJSXElement() && ctx.routeElements.has(candidate.node),
      );
      const parent = parentPath === null
        ? null
        : ctx.routeElements.get(parentPath.node as t.JSXElement)!;
      let fullPattern: string;
      try {
        fullPattern = parent === null
          ? pattern
          : joinRoutePattern(parent.fullPattern, pattern);
      } catch (error) {
        throw attributePath.buildCodeFrameError(`memo-dom: ${(error as Error).message}`);
      }
      const inherited = new Set(
        parent === null ? [] : routeParameterNames(parent.fullPattern),
      );
      for (const name of routeParameterNames(pattern)) {
        if (inherited.has(name)) {
          throw attributePath.buildCodeFrameError(
            `memo-dom: route '${fullPattern}' shadows active parameter '${name}'`,
          );
        }
      }
      const definition: CompilerRouteElement = {
        id: routeId(ctx.moduleId, elementPath.node, fallback++),
        moduleId: ctx.moduleId,
        pattern,
        fullPattern,
        ...(parent === null ? {} : { parentId: parent.id }),
        ...(elementPath.node.openingElement.loc?.start.line === undefined
          ? {}
          : { line: elementPath.node.openingElement.loc.start.line }),
        ...(elementPath.node.openingElement.loc?.start.column === undefined
          ? {}
          : { column: elementPath.node.openingElement.loc.start.column }),
      };
      ctx.routeElements.set(elementPath.node, definition);
      localDefinitions.push(definition);
      ctx.localRoutes.push(definition);
      ctx.usesRouter = true;
      attributePath.remove();
    },
  });

  const definitions = ctx.linkedRoutes ?? localDefinitions;
  validateCompilerRouteGraph(definitions);
  const knownRoutes = new Map(
    definitions.map((definition) => [definition.fullPattern, definition]),
  );

  programPath.traverse({
    JSXElement(elementPath) {
      const attributePath = elementPath
        .get('openingElement')
        .get('attributes')
        .find(
          (candidate): candidate is NodePath<t.JSXAttribute> =>
            candidate.isJSXAttribute() &&
            jsxAttributeName(candidate.node.name) === 'route-to',
        );
      if (attributePath === undefined) return;
      const target = routeToTarget(attributePath, knownRoutes);
      ctx.usesRouter = true;
      attributePath.remove();
      installRouteTo(ctx, elementPath, attributePath, target);
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
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.cloneNode(manifest),
        t.callExpression(mr(ctx, 'createRouteManifest'), [
          t.arrayExpression(
            definitions.map((definition) =>
              t.objectExpression([
                t.objectProperty(t.identifier('id'), t.stringLiteral(definition.id)),
                t.objectProperty(t.identifier('pattern'), t.stringLiteral(definition.pattern)),
                ...(definition.parentId === undefined
                  ? []
                  : [
                      t.objectProperty(
                        t.identifier('parentId'),
                        t.stringLiteral(definition.parentId),
                      ),
                    ]),
              ]),
            ),
          ),
        ]),
      ),
    ]),
    t.expressionStatement(
      t.callExpression(mr(ctx, 'replaceRouteResolver'), [
        t.memberExpression(t.cloneNode(manifest), t.identifier('resolve')),
      ]),
    ),
    t.expressionStatement(t.callExpression(mr(ctx, 'ensureRouterConnected'), [])),
  ];
}
