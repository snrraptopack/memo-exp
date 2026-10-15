/** Stable native callback descriptors from the shared structural callback plan. */
import * as b from '../ast/factory';
import type * as t from '../ast/compiler-types';
import { cloneNode } from '../ast';
import { generatedIdentifier } from '../emission/identifiers';
import { emitNativeRow, type NativeRowEmission } from './list-emission';
import type { NativeViewEmissionInputs } from './view-emission';

export function emitNativeRenderCallback(
  inputs: NativeViewEmissionInputs,
  value: t.Expression,
  inSvg: boolean,
  emission: NativeRowEmission,
): t.Identifier {
  const { ctx, component } = inputs;
  const plan = component.regionShapes.renderCallbackFor(value);
  const adapter = generatedIdentifier(ctx, 'renderCallback');
  const callbackIndex = inputs.slotCount.value++;
  const templateKey = `${inputs.moduleId}#${component.name}/$callback[${callbackIndex}]`;
  const create = emitNativeRow(
    inputs,
    {
      ...plan,
      prelude: [],
      sourceKey: '$render-callback',
      sourceLocal: true,
      keyExpr: plan.keyExpression,
    },
    plan.jsx,
    templateKey,
    inSvg,
    emission,
  );
  const key = plan.keyExpression === null
    ? b.nullLiteral()
    : b.arrowFunctionExpression(
      [
        cloneNode(plan.itemPattern),
        ...(plan.indexParam === null ? [] : [b.identifier(plan.indexParam)]),
      ],
      cloneNode(plan.keyExpression),
    );

  inputs.prelude.push(b.variableDeclaration('const', [
    b.variableDeclarator(cloneNode(adapter), b.objectExpression([
      b.objectProperty(b.identifier('create'), create),
      b.objectProperty(b.identifier('key'), key),
    ]),
    ),
  ]));

  return adapter;
}
