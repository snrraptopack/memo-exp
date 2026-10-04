import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode, isReferenceIdentifier, walkAst } from '../ast';
import {
  keyPathOf,
  type ComponentPath,
  type Ctx,
  type RowCtx,
} from '../context';
import { componentId, generatedIdentifier, md } from '../identifiers';
import { type MapSite } from '../lists';
import {
  cacheDecl,
  newEmitScope,
  registerStmt,
  updateBody,
  updateDecl,
  type RegionSourcePlans,
} from './scope';
import type { NodeEmitter } from './node-emitter';
import { applyRepeatedDomTemplate } from './dom-template';
import type { InitialDomRoot } from './initial-dom';

export function buildInlineRowCreate(
  ctx: Ctx,
  site: MapSite,
  componentName: string,
  componentPath: ComponentPath,
  emitNode: NodeEmitter,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, componentName),
  eventBindings: ReadonlyMap<string, t.Identifier> = new Map(),
  lightweight = false,
  sources: RegionSourcePlans | null = null,
  initial?: InitialDomRoot,
): t.ArrowFunctionExpression {
  site.jsx!.openingElement.attributes =
    site.jsx!.openingElement.attributes.filter(
      (attribute) =>
        astFactory.isJSXSpreadAttribute(attribute) ||
        (attribute.name as t.JSXIdentifier).name !== 'key',
    );
  const rowScope = newEmitScope(ctx, false, sources);
  rowScope.cacheText = true;
  const initialRoot = initial ? generatedIdentifier(ctx, 'initialRow') : null;
  if (initial) rowScope.initialDom={plan:initial,variable:generatedIdentifier(ctx,'initialRowNodes').name,
    descriptors:[],adopting:initialRoot!};
  for (const statement of site.prelude) {
    rowScope.creation.push(cloneEstreeNode(statement));
    rowScope.updaters.push(() => cloneEstreeNode(statement));
  }
  for (const [eventName, binding] of eventBindings) {
    rowScope.delegatedEventBindings.set(eventName, binding.name);
  }
  const rowId = generatedIdentifier(ctx, 'rowId').name;
  const nextItem = generatedIdentifier(ctx, 'nextItem');
  const nextIndex =
    site.indexParam === null ? null : generatedIdentifier(ctx, 'nextIndex');
  const rowContext: RowCtx = {
    itemParam: site.itemParam,
    itemPath: [],
    rowIdVar: rowId,
    ...(lightweight ? { refreshVar: rowScope.updateVar } : {}),
    keyPath: keyPathOf(site.keyExpr, site.itemParam),
    sourceKey: site.sourceKey,
    sourceLocal: site.sourceLocal,
    ...(site.sourceLocal
      ? {
          ownerIdVar: astFactory.isIdentifier(ownerId)
            ? ownerId.name
            : componentId(ctx, componentName).name,
        }
      : {}),
  };
  const rootVariable = emitNode(
    ctx,
    rowScope,
    site.jsx!,
    componentName,
    componentPath,
    'row',
    rowContext,
    lightweight ? undefined : astFactory.identifier(rowId),
    inSvg,
    astFactory.identifier(rowId),
  );
  if (!initial) applyRepeatedDomTemplate(ctx, rowScope, rootVariable);
  if (initial) rowScope.prelude.unshift(astFactory.variableDeclaration('const',[
    astFactory.variableDeclarator(astFactory.identifier(rowScope.initialDom!.variable),
      astFactory.conditionalExpression(initialRoot!,astFactory.callExpression(md(ctx,'bindInitialNodes'),[
        initialRoot!,
        astFactory.arrayExpression(rowScope.initialDom!.descriptors),
      ]),astFactory.arrayExpression([]))),
  ]));
  const bindingUpdates: t.Statement[] =
    [
      astFactory.expressionStatement(
        astFactory.assignmentExpression(
          '=',
          cloneEstreeNode(site.itemPattern, true),
          cloneEstreeNode(nextItem),
        ),
      ),
    ];
  if (nextIndex !== null && site.indexParam !== null) {
    bindingUpdates.push(
      astFactory.expressionStatement(
        astFactory.assignmentExpression(
          '=',
          astFactory.identifier(site.indexParam),
          cloneEstreeNode(nextIndex),
        ),
      ),
    );
  }
  // Materialize the content plan once: generating it twice could allocate new
  // temporaries or repeat emitter work. The fused binding/content function owns
  // an exact clone, preserving read order and all ordinary content checks.
  const contentUpdates = updateBody(ctx, rowScope);
  const needsStandaloneUpdate = !lightweight || [
    ...rowScope.prelude, ...rowScope.creation, ...rowScope.mounts, ...contentUpdates,
  ].some(statement => {
    let referenced = false;
    walkAst(statement, { enter(node, parent, key) {
      if (referenced) return false;
      if (astFactory.isIdentifier(node, { name: rowScope.updateVar }) && isReferenceIdentifier(parent, key)) referenced = true;
    }});
    return referenced;
  });

  return astFactory.arrowFunctionExpression(
    [
      cloneEstreeNode(site.itemPattern, true),
      astFactory.identifier(rowId),
      ...(site.indexParam === null
        ? initial ? [generatedIdentifier(ctx,'unusedIndex')] : []
        : [astFactory.identifier(site.indexParam)]),
      ...(initialRoot ? [initialRoot] : []),
    ],
    astFactory.blockStatement([
      cacheDecl(rowScope),
      ...(needsStandaloneUpdate ? [updateDecl(ctx, rowScope, contentUpdates)] : []),
      ...rowScope.prelude,
      ...(lightweight ? [] : [registerStmt(
        ctx,
        astFactory.identifier(rowId),
        cloneEstreeNode(ownerId),
        astFactory.identifier(rowScope.updateVar),
      )]),
      ...rowScope.creation,
      ...rowScope.mounts,
      astFactory.returnStatement(
        astFactory.objectExpression([
          astFactory.objectProperty(
            astFactory.identifier('nodes'),
            astFactory.identifier(rootVariable),
          ),
          astFactory.objectProperty(
            astFactory.identifier('entities'),
            astFactory.arrayExpression(lightweight ? [] : [astFactory.identifier(rowId)]),
          ),
          astFactory.objectProperty(
            astFactory.identifier('update'),
            astFactory.arrowFunctionExpression(
              [
                cloneEstreeNode(nextItem),
                ...(nextIndex === null
                  ? []
                  : [cloneEstreeNode(nextIndex)]),
              ],
              astFactory.blockStatement([
                ...bindingUpdates,
                ...(lightweight ? [] : [astFactory.ifStatement(
                  astFactory.unaryExpression('!', astFactory.callExpression(md(ctx, 'getEntity'), [astFactory.identifier(rowId)])),
                  astFactory.returnStatement(null),
                )]),
                ...contentUpdates.map(statement => cloneEstreeNode(statement, true)),
              ]),
            ),
          ),
        ]),
      ),
    ]),
  );
}
