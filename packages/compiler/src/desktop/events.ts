/** Event source addresses and native bindings use shared callback/write plans. */
import type { OrderedAttributePlan } from '../jsx/attributes';
import type { ExplicitHostEvent } from './template-plan';
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { cloneNode } from '../ast';
import { keyPathOf } from '../context';
import { planHandlerWrites } from '../handlers/analyze';
import { generatedIdentifier } from '../emission/identifiers';
import type { CallbackSourcePlan } from '../planning/component-callbacks';
import type { NativeViewEmissionInputs } from './view-emission';
import { emitNativePublication } from './publication';

function rowFacts(inputs: NativeViewEmissionInputs) {
  const row = inputs.parentRow;
  return row === undefined ? undefined : {
    ...row,
    itemPath: [],
    keyPath: keyPathOf(row.keyExpr, row.itemParam),
    localRefresh: false,
  };
}

export function templateEvents(source: number, plan: OrderedAttributePlan): ExplicitHostEvent[] {
  const events: ExplicitHostEvent[] = [];

  for (let entry = 0; entry < plan.entries.length; entry++) {
    const attribute = plan.entries[entry]!;

    if (attribute.type === 'attribute' && attribute.event) {
      // The emitter evaluates the entire ordered plan before choosing final
      // bindings. A later spread or duplicate may override this event value.
      events.push({ source, entry, name: attribute.name });
    }
  }

  return events;
}

/** Named helpers remain at component scope and cannot capture row bindings. */
export function emitNativeCallbackSource(
  inputs: NativeViewEmissionInputs,
  source: CallbackSourcePlan,
): void {
  if (inputs.ctx.analyzedFunctions.has(source.target)) return;

  for (const helper of source.helpers) emitNativeCallbackSource(inputs, helper);
  emitNativePublication(inputs.ctx, source.writesFor(), inputs.fail);
}

/** Component callback props keep their caller's shared write-publication owner. */
export function emitNativeCallbackValue(
  inputs: NativeViewEmissionInputs,
  value: t.Expression,
): t.Expression {
  const source = inputs.component.callbacks.forValue(value, true);
  if (source === null) return value;

  for (const helper of source.helpers) emitNativeCallbackSource(inputs, helper);
  emitNativePublication(
    inputs.ctx,
    source.writesFor(b.isIdentifier(value) ? undefined : rowFacts(inputs)),
    inputs.fail,
    b.isIdentifier(value) ? undefined : inputs.rowTarget,
  );

  if (b.isIdentifier(value)) return value;
  const binding = generatedIdentifier(inputs.ctx, 'callback');
  inputs.prelude.push(b.variableDeclaration('const', [
    b.variableDeclarator(cloneNode(binding), source.target as t.Expression),
  ]));
  return binding;
}

/** Resolve only callback semantics; attribute ordering stays in the shared emitter. */
export function emitNativeEventValue(
  inputs: NativeViewEmissionInputs,
  viewFrame: t.Identifier,
  value: t.Expression,
): t.Expression {
  const { ctx, component, nativeId, rowTarget, fail } = inputs;
  const shared = b.isIdentifier(value) ? ctx.helpers.get(value.name) : undefined;

  if (shared !== undefined && !ctx.analyzedFunctions.has(shared.node)) {
    if (ctx.moduleCallbacks === null) throw new Error('Native module callbacks were not planned');
    emitNativePublication(ctx, ctx.moduleCallbacks.writesFor(shared.node, true), fail);
  }

  if (shared !== undefined && ctx.handlerHasRootCommit.get(shared.node) === true) {
    return value;
  }

  const source = component.callbacks.forEvent(value, true);
  const origin = b.callExpression(
    b.memberExpression(cloneNode(nativeId), b.identifier('frameId')),
    [cloneNode(viewFrame)],
  );

  if (source !== null) {
    for (const helper of source.helpers) emitNativeCallbackSource(inputs, helper);
    emitNativePublication(ctx, source.writesFor(rowFacts(inputs), true), fail, rowTarget, origin);
    return b.isIdentifier(value) ? value : source.target as t.Expression;
  }

  // Shared or forwarded handlers keep their original receiver and result. The
  // event wrapper supplies linked argument effects and a write-free origin.
  const event = generatedIdentifier(ctx, 'event');
  const wrapper = b.arrowFunctionExpression(
    [event],
    b.callExpression(cloneNode(value), [cloneNode(event)]),
  );
  const plan = planHandlerWrites(ctx, wrapper, component.name, undefined, true, true);
  emitNativePublication(ctx, plan, fail, undefined, origin);
  return wrapper;
}
