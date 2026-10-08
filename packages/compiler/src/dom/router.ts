/** DOM routing lowering and emitted browser integration. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {cloneNode as cloneEstreeNode} from '../ast';
import type {DomContext as Ctx} from './context';
import {generatedIdentifier,mr} from './identifiers';
import {attributeNamed,propertyName,type RouteToTarget,type DiagnosticNode,type RouterSourcePlan} from '../analysis/routes';

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
  if (tag !== 'a') {
    throw attributePath.buildCodeFrameError(
      'memo-dom: route-to requires an anchor; use <a route-to="/path"> for navigation or call navigate() from an action handler',
    );
  }
  if (opening.attributes.some((attribute) => astFactory.isJSXSpreadAttribute(attribute))) {
    throw attributePath.buildCodeFrameError(
      'memo-dom: route-to cannot be combined with JSX prop spreads because navigation ownership must be static',
    );
  }

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
}

/** Consume the shared route plan and install the DOM backend's host behavior. */
export function lowerRouterJsx(ctx:Ctx,plan:RouterSourcePlan):void {
  for(const {element,attribute,definition} of plan.routes) {
    ctx.routeElements.set(element,definition);
    ctx.localRoutes.push(definition);
    ctx.usesRouter=true;
    element.openingElement.attributes=element.openingElement.attributes.filter(candidate=>candidate!==attribute);
  }
  for(const {element,attribute,diagnostic,target} of plan.links) {
    ctx.usesRouter=true;
    element.openingElement.attributes=element.openingElement.attributes.filter(candidate=>candidate!==attribute);
    installRouteTo(ctx,element,diagnostic,target);
  }
}

export function routeManifestStatements(ctx: Ctx): t.Statement[] {
  if (!ctx.emitRouteManifest) return [];
  const definitions = ctx.linkedRoutes ?? ctx.localRoutes;
  if (definitions.length === 0) return [];
  ctx.usesRouter = true;
  const matcher = generatedIdentifier(ctx, 'routeMatcher');
  const location = generatedIdentifier(ctx, 'routeLocation');
  const byId = new Map(definitions.map(definition => [definition.id, definition]));
  const chainFor = (id: string): string[] => {
    const chain: string[] = [];
    for (let current = byId.get(id); current !== undefined; current =
      current.parentId === undefined ? undefined : byId.get(current.parentId)) chain.push(current.id);
    return chain.reverse();
  };
  // Match precedence for equal ancestor/descendant patterns follows depth.
  const ordered = [...definitions].sort((left, right) => chainFor(left.id).length - chainFor(right.id).length);
  const indexes = new Map(ordered.map((definition, index) => [definition.id, index]));
  return [
    astFactory.variableDeclaration('const', [
      astFactory.variableDeclarator(
        cloneEstreeNode(matcher),
        astFactory.callExpression(mr(ctx, 'createPreparedRouteMatcher'), [
          astFactory.arrayExpression(
            ordered.map((definition) =>
              astFactory.objectExpression([
                astFactory.objectProperty(astFactory.identifier('id'), astFactory.stringLiteral(definition.id)),
                astFactory.objectProperty(astFactory.identifier('pattern'), astFactory.stringLiteral(definition.pattern)),
                astFactory.objectProperty(astFactory.identifier('fullPattern'), astFactory.stringLiteral(definition.fullPattern)),
                astFactory.objectProperty(astFactory.identifier('ownParamNames'), astFactory.arrayExpression(
                  definition.pattern.split('/').filter(segment => segment === '*' || segment.startsWith(':'))
                    .map(segment => astFactory.stringLiteral(segment === '*' ? '*' : segment.slice(1))),
                )),
                astFactory.objectProperty(astFactory.identifier('chain'), astFactory.arrayExpression(
                  chainFor(definition.id).map(id => astFactory.numericLiteral(indexes.get(id)!)),
                )),
                ...((definition.preparations === undefined ||
                  definition.preparations.length === 0) &&
                  definition.componentKey === undefined &&
                  definition.lazyComponent === undefined
                  ? []
                  : [
                      astFactory.objectProperty(
                        astFactory.identifier('metadata'),
                        astFactory.objectExpression([
                          ...(definition.preparations === undefined ||
                            definition.preparations.length === 0
                            ? []
                            : [astFactory.objectProperty(
                                astFactory.identifier('preparations'),
                                astFactory.arrayExpression(
                                  definition.preparations.map(id =>
                                    astFactory.stringLiteral(id)),
                                ),
                              )]),
                          ...(definition.componentKey === undefined
                            ? []
                            : [astFactory.objectProperty(
                                astFactory.identifier('componentKey'),
                                astFactory.stringLiteral(definition.componentKey),
                              ),
                              astFactory.objectProperty(
                                astFactory.identifier('componentModuleId'),
                                astFactory.stringLiteral(definition.componentKey.slice(
                                  0, definition.componentKey.lastIndexOf('#'),
                                )),
                              )]),
                          ...(definition.lazyComponent === undefined
                            ? []
                            : [astFactory.objectProperty(
                                astFactory.identifier('moduleLoader'),
                                astFactory.arrowFunctionExpression([], astFactory.callExpression(
                                  astFactory.memberExpression(
                                    {
                                      type: 'ImportExpression',
                                      source: astFactory.stringLiteral(definition.lazyComponent.specifier),
                                    },
                                    astFactory.identifier('then'),
                                  ),
                                  [astFactory.arrowFunctionExpression(
                                    [astFactory.identifier('module')],
                                    astFactory.callExpression(mr(ctx, 'registerRouteComponent'), [
                                      astFactory.stringLiteral(definition.componentKey!),
                                      astFactory.memberExpression(
                                        astFactory.identifier('module'),
                                        astFactory.stringLiteral(definition.lazyComponent.exportName),
                                        true,
                                      ),
                                    ]),
                                  )],
                                )),
                              )]),
                        ]),
                      ),
                    ]),
              ]),
            ),
          ),
        ]),
      ),
    ]),
    astFactory.expressionStatement(
      astFactory.callExpression(mr(ctx, 'replacePreparedRouteResolver'), [
        astFactory.arrowFunctionExpression([cloneEstreeNode(location)], astFactory.callExpression(cloneEstreeNode(matcher), [
          astFactory.memberExpression(cloneEstreeNode(location), astFactory.identifier('pathname')),
        ])),
      ]),
    ),
    astFactory.expressionStatement(astFactory.callExpression(mr(ctx, 'ensureRouterConnected'), [])),
  ];
}

export function initialRoutePreparationStatements(ctx: Ctx): t.Statement[] {
  if (!ctx.emitRouteManifest || ctx.routedEnvironment !== 'client') return [];
  const definitions = ctx.linkedRoutes ?? ctx.localRoutes;
  if (!definitions.some(definition => definition.lazyComponent !== undefined ||
      (definition.preparations?.length ?? 0) > 0)) return [];
  const preparesData = definitions.some(definition => (definition.preparations?.length ?? 0) > 0);
  return [astFactory.expressionStatement({
    type: 'AwaitExpression',
    argument: astFactory.callExpression(mr(ctx, preparesData ? 'prepareInitialRoute' : 'prepareInitialRouteModules'), []),
  })];
}
