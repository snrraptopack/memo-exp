/** Event addresses are separate from attribute materialization and native dispatch. */
import type { OrderedAttributePlan } from '../jsx/attributes';
import type { ExplicitHostEvent } from './template-plan';

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
