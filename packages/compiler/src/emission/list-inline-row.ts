import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import {
  keyPathOf,
  type ComponentPath,
  type Ctx,
  type RowCtx,
} from '../context';
import { componentId, generatedIdentifier } from '../identifiers';
import { type MapSite } from '../lists';
import {
  cacheDecl,
  newEmitScope,
  registerStmt,
  updateDecl,
} from './scope';
import type { NodeEmitter } from './node-emitter';
import { applyRepeatedDomTemplate } from './dom-template';
import type { ComponentRegionReplay } from '../analysis/region-replay';

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
  regionReplay: ComponentRegionReplay | null = null,
): t.ArrowFunctionExpression {
  site.jsx!.openingElement.attributes =
    site.jsx!.openingElement.attributes.filter(
      (attribute) =>
        astFactory.isJSXSpreadAttribute(attribute) ||
        (attribute.name as t.JSXIdentifier).name !== 'key',
    );
  const rowScope = newEmitScope(ctx);
  rowScope.regionReplay = regionReplay;
  rowScope.cacheText = true;
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
  applyRepeatedDomTemplate(ctx, rowScope, rootVariable);
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

  return astFactory.arrowFunctionExpression(
    [
      cloneEstreeNode(site.itemPattern, true),
      astFactory.identifier(rowId),
      ...(site.indexParam === null
        ? []
        : [astFactory.identifier(site.indexParam)]),
    ],
    astFactory.blockStatement([
      cacheDecl(rowScope),
      updateDecl(ctx, rowScope),
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
            astFactory.identifier('updateProps'),
            astFactory.arrowFunctionExpression(
              [
                cloneEstreeNode(nextItem),
                ...(nextIndex === null
                  ? []
                  : [cloneEstreeNode(nextIndex)]),
              ],
              astFactory.blockStatement(bindingUpdates),
            ),
          ),
          astFactory.objectProperty(
            astFactory.identifier('update'),
            astFactory.identifier(rowScope.updateVar),
          ),
        ]),
      ),
    ]),
  );
}
