/** Authored JSX route graph, destination validation and source contracts. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {cloneNode as cloneEstreeNode,ESTREE_VISITOR_KEYS,childNode,childNodes,nodeFields as fields,stringValue,walkAst,type BaseNode} from '../ast';
import {jsxAttributeName} from '../jsx/attributes';

const PARAMETER_SEGMENT = /^:([A-Za-z_$][A-Za-z0-9_$]*)$/;

export interface CompilerRouteDefinition {
  readonly id: string;
  readonly moduleId: string;
  readonly pattern: string;
  readonly fullPattern: string;
  readonly parentId?: string;
  /** Authored local component associated with this route-bearing region. */
  readonly component?: string;
  /** Component whose body declares this route template. */
  readonly ownerComponent?: string;
  /** Component mounted by a route-bearing JSX callsite. */
  readonly calleeComponent?: string;
  /** Linker-resolved component identity used to attach route preparation. */
  readonly componentKey?: string;
  /** Imported route-only component, resolved by the linker for client chunks. */
  readonly lazyComponent?: {
    readonly moduleId: string;
    readonly exportName: string;
    readonly specifier: string;
  };
  readonly preparations?: readonly string[];
  readonly line?: number;
  readonly column?: number;
}

export interface CompilerRouteElement extends CompilerRouteDefinition {}

export interface RouteToTarget {
  readonly path: string;
  readonly options: t.ObjectExpression | null;
}

export interface ProgramContainer {
  node: t.Program;
  buildCodeFrameError(message: string, at?: t.Node): Error;
}

export interface DiagnosticNode<TNode> {
  node: TNode;
  buildCodeFrameError(message: string): Error;
}

export function attributeNamed(
  element: t.JSXElement,
  name: string,
): t.JSXAttribute | undefined {
  return element.openingElement.attributes.find(
    (attribute): attribute is t.JSXAttribute =>
      astFactory.isJSXAttribute(attribute) &&
      jsxAttributeName(attribute.name) === name,
  );
}

export function staticAttributeString(attribute: t.JSXAttribute): string | null {
  const value = attribute.value as unknown as BaseNode | null;
  if (value?.type === 'JSXExpressionContainer') {
    return stringValue(childNode(value, 'expression'));
  }
  return stringValue(value);
}

function routeId(
  moduleId: string,
  owner: string | null,
  ancestor: CompilerRouteDefinition | null,
  tag: string,
  pattern: string,
  occurrences: Map<string, number>,
): string {
  const base = ancestor?.id ?? `${moduleId}#route:${owner ?? '$module'}`;
  const key = `${base}/${encodeURIComponent(tag)}:${encodeURIComponent(pattern)}`;
  const occurrence = occurrences.get(key) ?? 0;
  occurrences.set(key, occurrence + 1);
  return occurrence === 0 ? key : `${key}[${occurrence}]`;
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
  const occurrences = new Map<string, number>();

  const visit = (
    currentNode: BaseNode,
    ancestor: CompilerRouteDefinition | null,
    ownerComponent: string | null,
  ): void => {
    let owner = ownerComponent;
    if (currentNode.type === 'FunctionDeclaration') {
      const id = childNode(currentNode, 'id');
      if (
        id !== null &&
        astFactory.isIdentifier(id) &&
        /^[A-Z]/.test(id.name)
      ) owner = id.name;
    }
    if (currentNode.type === 'VariableDeclarator') {
      const id = childNode(currentNode, 'id');
      const init = childNode(currentNode, 'init');
      if (
        id !== null &&
        astFactory.isIdentifier(id) &&
        /^[A-Z]/.test(id.name) &&
        init !== null &&
        astFactory.isFunction(init)
      ) {
        visit(init, ancestor, id.name);
        return;
      }
    }
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
            id: routeId(
              moduleId,
              owner,
              ancestor,
              astFactory.isJSXIdentifier(element.openingElement.name)
                ? element.openingElement.name.name : '$element',
              pattern,
              occurrences,
            ),
            moduleId,
            pattern,
            fullPattern,
            ...(owner === null ? {} : { ownerComponent: owner }),
            ...(astFactory.isJSXIdentifier(element.openingElement.name) &&
              /^[A-Z]/.test(element.openingElement.name.name)
              ? { calleeComponent: element.openingElement.name.name }
              : {}),
            ...(ancestor === null ? {} : { parentId: ancestor.id }),
            ...(astFactory.isJSXIdentifier(element.openingElement.name) &&
              /^[A-Z]/.test(element.openingElement.name.name)
              ? { component: element.openingElement.name.name }
              : owner === null ? {} : { component: owner }),
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
        visit(attribute as unknown as BaseNode, current, owner);
      }
      for (const child of element.children) {
        visit(child as unknown as BaseNode, current, owner);
      }
      return;
    }
    if (currentNode.type === 'JSXFragment') {
      for (const child of childNodes(currentNode, 'children')) {
        visit(child, ancestor, owner);
      }
      return;
    }
    for (const key of ESTREE_VISITOR_KEYS[currentNode.type] ?? []) {
      const value = fields(currentNode)[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child !== null && typeof child === 'object' && 'type' in child) {
            visit(child as BaseNode, ancestor, owner);
          }
        }
      } else if (value !== null && typeof value === 'object' && 'type' in value) {
        visit(value as BaseNode, ancestor, owner);
      }
    }
  };

  visit(root, null, null);
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
  return `/${pathSegments(pattern)
    .map((segment) => segment === '*' ? '*' : segment.startsWith(':') ? ':param' : segment)
    .join('/')}`;
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
    // Linked callsites can introduce parameter collisions across modules.
    validateCompilerRoutePattern(definition.fullPattern);
    if (definition.parentId !== undefined && !byId.has(definition.parentId)) {
      throw new TypeError(
        `route '${definition.fullPattern}' references a missing compiler parent`,
      );
    }
    const parent = definition.parentId === undefined ? undefined : byId.get(definition.parentId);
    if (parent?.fullPattern.endsWith('/*')) {
      throw new TypeError(`catch-all route '${parent.fullPattern}' cannot have child routes`);
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

export function propertyName(property: t.ObjectProperty): string | null {
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
    const allowed = new Set(['path', 'params', 'query', 'hash']);
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

export interface RouterSourcePlan {
  readonly routes:readonly {
    readonly element:t.JSXElement;
    readonly attribute:t.JSXAttribute;
    readonly definition:CompilerRouteElement;
  }[];
  readonly links:readonly {
    readonly element:t.JSXElement;
    readonly attribute:t.JSXAttribute;
    readonly diagnostic:DiagnosticNode<t.JSXAttribute>;
    readonly target:RouteToTarget;
  }[];
}

/** Capture graph and destination contracts without erasing or generating JSX. */
export function planRouterJsx(
  program:ProgramContainer,moduleId:string,linkedRoutes:readonly CompilerRouteDefinition[]|null=null,
):RouterSourcePlan {
  const definitions=collectCompilerRoutes(program.node,moduleId);
  const routes:RouterSourcePlan['routes'][number][]=[];
  walkAst<BaseNode>(program.node as unknown as BaseNode,{enter(node){
    if(node.type!=='JSXElement')return;
    const element=node as unknown as t.JSXElement,attribute=attributeNamed(element,'route');
    if(attribute===undefined)return;
    if(staticAttributeString(attribute)===null)
      throw program.buildCodeFrameError('memo-dom: route must be a static string beginning with /',attribute);
    const definition=definitions[routes.length];
    if(definition===undefined)
      throw program.buildCodeFrameError('memo-dom: route collection order changed during compilation',attribute);
    routes.push({element,attribute,definition});
  }});
  const graph=linkedRoutes??definitions;
  validateCompilerRouteGraph(graph);
  const known=new Map(graph.map(definition=>[definition.fullPattern,definition]));
  const links:RouterSourcePlan['links'][number][]=[];
  walkAst<BaseNode>(program.node as unknown as BaseNode,{enter(node){
    if(node.type!=='JSXElement')return;
    const element=node as unknown as t.JSXElement,attribute=attributeNamed(element,'route-to');
    if(attribute===undefined)return;
    const diagnostic={node:attribute,buildCodeFrameError:(message:string)=>program.buildCodeFrameError(message,attribute)};
    links.push({element,attribute,diagnostic,target:routeToTarget(diagnostic,known)});
  }});
  return {routes,links};
}
