/** Native row factories consume the shared list source/key/callback plans. */
import * as b from '../ast/factory';
import type * as t from '../ast/compiler-types';
import { cloneNode } from '../ast';
import { generatedIdentifier } from '../emission/identifiers';
import { allocateMapSite } from '../lists/map-site';
import type { MapSite } from '../lists/map-site';
import type { HostRegionStep, NativeTemplatePlan } from './template-plan';
import type { NativeViewEmissionInputs } from './view-emission';

export interface NativeRowEmission {
  readonly lower: (jsx: t.JSXElement, key: string, inSvg: boolean) => NativeTemplatePlan;
  readonly evaluate: (plan: NativeTemplatePlan) => t.Expression;
  readonly create: (
    inputs: NativeViewEmissionInputs,
    plan: NativeTemplatePlan,
    frame: t.Identifier,
    evaluate: t.ArrowFunctionExpression,
  ) => t.CallExpression;
}

/** Direct maps and delegated callback props emit the same native row closure. */
export function emitNativeRow(
  inputs: NativeViewEmissionInputs,
  shape: Pick<MapSite, 'itemPattern' | 'itemParam' | 'indexParam' | 'prelude' | 'sourceKey' | 'sourceLocal' | 'keyExpr'>,
  jsx: t.JSXElement,
  templateKey: string,
  inSvg: boolean,
  emission: NativeRowEmission,
): t.ArrowFunctionExpression {
  const { ctx } = inputs;
  const rowInputs: NativeViewEmissionInputs = {
    ...inputs,
    parentRow: shape,
    listPrefixes: new Map(),
    // Row-owned slots must close over row bindings, never escape to the caller.
    prelude: [],
  };
  const rowPlan = emission.lower(jsx, templateKey, inSvg);
  const rowFrame = generatedIdentifier(ctx, 'rowFrame');
  const rowView = generatedIdentifier(ctx, 'rowView');
  const nextItem = generatedIdentifier(ctx, 'nextItem');
  const nextIndex = generatedIdentifier(ctx, 'nextIndex');
  const evaluation = b.arrowFunctionExpression([], b.blockStatement([
    ...shape.prelude.map(statement => cloneNode(statement)),
    b.returnStatement(emission.evaluate(rowPlan)),
  ]));
  const view = emission.create(rowInputs, rowPlan, rowFrame, evaluation);
  const bindings: t.Statement[] = [b.expressionStatement(
    b.assignmentExpression('=', cloneNode(shape.itemPattern), cloneNode(nextItem)),
  )];

  if (shape.indexParam !== null) {
    bindings.push(b.expressionStatement(b.assignmentExpression(
      '=', b.identifier(shape.indexParam), cloneNode(nextIndex),
    )));
  }

  return b.arrowFunctionExpression([
    cloneNode(rowFrame),
    cloneNode(shape.itemPattern),
    ...(shape.indexParam === null ? [] : [b.identifier(shape.indexParam)]),
  ], b.blockStatement([
    ...rowInputs.prelude,
    b.variableDeclaration('const', [b.variableDeclarator(cloneNode(rowView), view)]),
    b.returnStatement(b.objectExpression([
      b.objectProperty(b.identifier('view'), cloneNode(rowView)),
      b.objectProperty(b.identifier('update'), b.arrowFunctionExpression(
        [nextItem, nextIndex], b.blockStatement(bindings),
      )),
    ])),
  ]));
}

export function emitNativeList(
  inputs: NativeViewEmissionInputs,
  step: HostRegionStep & { readonly content: { readonly type: 'list' } },
  emission: NativeRowEmission,
): t.CallExpression {
  const { ctx, component, nativeId, fail } = inputs;
  const call = step.content.expression;
  const callback = component.regionShapes.listCallbackFor(call);
  const plan = component.listSites.listFor(call, callback, inputs.parentRow);
  const site = allocateMapSite(call, plan, component.name, inputs.listPrefixes);

  if (site.form === 'callback') {
    const listFrame = generatedIdentifier(ctx, 'callbackListFrame');
    const read = site.optional
      ? b.logicalExpression('??', cloneNode(site.sourceExpr), b.arrayExpression([]))
      : cloneNode(site.sourceExpr);
    const create = b.arrowFunctionExpression([listFrame], b.callExpression(
      b.memberExpression(cloneNode(nativeId), b.identifier('createCallbackList')),
      [
        cloneNode(listFrame),
        b.arrowFunctionExpression([], read),
        b.arrowFunctionExpression([], cloneNode(site.renderCallback!)),
      ],
    ));

    return b.callExpression(
      b.memberExpression(cloneNode(nativeId), b.identifier('child')),
      [b.stringLiteral(site.suffix), b.numericLiteral(step.source), create],
    );
  }

  if (site.jsx === null) {
    fail('Native row requires a shared JSX callback plan', call);
  }

  // Key evaluation belongs to the shared key plan, not the row's attributes.
  // Strip only the root key from a clone; retain spread evaluation order.
  const jsx = cloneNode(site.jsx!);
  jsx.openingElement.attributes = jsx.openingElement.attributes.filter(attribute =>
    !b.isJSXAttribute(attribute) || !b.isJSXIdentifier(attribute.name, { name: 'key' }));

  const createRow = emitNativeRow(
    inputs, site, jsx, `${inputs.moduleId}#${component.name}/${site.suffix}/Row`, step.inSvg, emission,
  );

  let key: t.ArrowFunctionExpression | null = null;

  if (site.keyExpr !== null) {
    if (site.keyFromSpread) {
      // Spread keys fall back to raw item identity when their final value is
      // nullish. Destructuring must not replace that identity with one field.
      const keyItem = generatedIdentifier(ctx, 'keyItem');
      const keyIndex = generatedIdentifier(ctx, 'keyIndex');
      key = b.arrowFunctionExpression([keyItem, keyIndex], b.blockStatement([
        b.variableDeclaration('const', [
          b.variableDeclarator(cloneNode(site.itemPattern), cloneNode(keyItem)),
          ...(site.indexParam === null ? [] : [
            b.variableDeclarator(b.identifier(site.indexParam), cloneNode(keyIndex)),
          ]),
        ]),
        b.returnStatement(b.logicalExpression('??', cloneNode(site.keyExpr), cloneNode(keyItem))),
      ]));
    } else {
      key = b.arrowFunctionExpression([
        cloneNode(site.itemPattern),
        ...(site.indexParam === null ? [] : [b.identifier(site.indexParam)]),
      ], cloneNode(site.keyExpr));
    }
  }

  const listFrame = generatedIdentifier(ctx, 'listFrame');
  const read = site.optional
    ? b.logicalExpression('??', cloneNode(site.sourceExpr), b.arrayExpression([]))
    : cloneNode(site.sourceExpr);
  const create = b.arrowFunctionExpression([listFrame], b.callExpression(
    b.memberExpression(cloneNode(nativeId), b.identifier('createList')),
    [
      cloneNode(listFrame),
      b.arrowFunctionExpression([], read),
      createRow,
      ...(key === null ? [] : [key]),
    ],
  ));

  return b.callExpression(
    b.memberExpression(cloneNode(nativeId), b.identifier('child')),
    [b.stringLiteral(site.suffix), b.numericLiteral(step.source), create],
  );
}
