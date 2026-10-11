/** Adapt core lifecycle ownership to accepted native scene elements. */
import { cleanup, invalidateEntity, mountRef } from '@memoized-dom/runtime/core';
import type { Owner } from './ownership-model';
import type { SceneElement, SceneMountOptions } from './application';
import { affected } from './values';

export function configureOwnerLifecycle(owner: Owner, options: SceneMountOptions): void {
  for (const disposer of options.cleanups ?? []) cleanup(owner.entityId, disposer);
  const effects = (options.effects ?? []).map((binding) => ({ binding, values: binding.read() }));
  owner.effectInvalidations = (sources) => {
    for (const effect of effects) {
      const next = effect.binding.read();
      const changed = next.some((value, index) => !Object.is(value, effect.values[index]));
      effect.values = next;
      if (changed || (effect.binding.sources.length && affected(effect.binding.sources, sources))) {
        invalidateEntity(
          `${owner.entityId}/$effects/${effect.binding.index}${effect.binding.active ? '/$active' : ''}`,
        );
      }
    }
  };
  owner.activate = () => {
    if (owner.disposed || !owner.mounted) return;
    // Bind refs before effect callbacks, so effects can use accepted handles.
    for (const ref of options.refs ?? []) {
      const node = owner.template.nodes[ref.node];
      if (!node || node.kind !== 'element') throw new Error('Desktop ref requires an element');
      const element: SceneElement = Object.freeze({
        handle: owner.instance.handle,
        node: ref.node,
        tagName: node.tag.toUpperCase(),
        ownerDocument: null,
        get isConnected() {
          return owner.mounted && !owner.disposed;
        },
        get id() {
          return node.attributes?.id ?? '';
        },
        get value() {
          const slot = owner.template.slots.findIndex(
            (slot) => slot.node === ref.node && slot.type === 'value',
          );
          return slot < 0 ? (node.attributes?.value ?? '') : (owner.acknowledged.get(slot) ?? '');
        },
        getAttribute(name: string) {
          return node.attributes?.[name] ?? null;
        },
      });
      cleanup(owner.entityId, mountRef(element, ref.value));
    }
    options.activate?.(owner.instance);
  };
}
