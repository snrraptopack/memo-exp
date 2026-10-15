/** Event addresses are separate from attribute materialization and native dispatch. */
import type { OrderedAttributePlan } from '../jsx/attributes';
import type { ExplicitHostEvent } from './template-plan';
import type { NativeTemplatePlan } from './template-plan';
import type * as t from '../ast/compiler-types';
import type { ComponentCallbacks } from '../planning/component-callbacks';
import type { MapSite } from '../lists/map-site';
import { keyPathOf } from '../context';
import { mapStaticAttributeValues } from '../emission/attributes';

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

/**
 * Shared write facts distinguish supported module-cell writes from row/prop
 * mutations. Until their guarded publication is emitted, diagnose the latter
 * rather than accepting a handler whose mutation cannot refresh its content.
 */
export function validateNativeEventWrites(
  plan: NativeTemplatePlan,
  callbacks: ComponentCallbacks,
  row: Pick<MapSite, 'itemParam' | 'sourceKey' | 'sourceLocal' | 'keyExpr'> | undefined,
  fail: (message: string, at: t.Node) => never,
): void {
  const facts = row === undefined ? undefined : {
    ...row,
    itemPath: [],
    keyPath: keyPathOf(row.keyExpr, row.itemParam),
    localRefresh: false,
  };

  const validate = (value: t.Expression): void => {
    const source = callbacks.forEvent(value);

    if (source === null) {
      return;
    }

    const pending = [source];

    while (pending.length > 0) {
      const callback = pending.pop()!;
      const writes = callback.writesFor(facts);

      for (const scope of writes.scopes.values()) {
        if (
          scope.rowLocal || scope.rowOwnerLocal || scope.instanceLocal ||
          scope.transparentWrites.size > 0
        ) {
          fail('Row and prop writes require shared guarded-publication emission', value);
        }
      }

      pending.push(...callback.helpers);
    }
  };

  for (const step of plan.steps) {
    if (step.kind !== 'attributes') {
      continue;
    }

    for (const entry of step.plan.entries) {
      if (entry.type === 'attribute') {
        if (entry.event) validate(entry.value);
      } else {
        // Proven literal spread values use the same named-value mapper as
        // component props. No getter or opaque spread is evaluated here.
        mapStaticAttributeValues(entry.value, (name, value) => {
          if (/^on[A-Z]/.test(name)) validate(value);
          return value;
        });
      }
    }
  }
}
