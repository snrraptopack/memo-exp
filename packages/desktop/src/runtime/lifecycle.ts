/** Adapt core lifecycle ownership to accepted native scene elements. */
import { cleanup, invalidateEntity, mountRef, type RefValue } from '@memoized-dom/runtime/core';
import type { Owner } from './ownership-model';
import type { SceneElement, SceneMountOptions } from './application';
import type { PreparedProperties } from './properties';
import { affected } from './values';
import type { SceneHandle, SceneMeasurement } from '../bridge/protocol';

type Measure = (handle: SceneHandle, node: number) => Promise<SceneMeasurement>;
type SetFocus = (handle: SceneHandle, node: number, focused: boolean, preventScroll: boolean) => Promise<void>;

export function configureOwnerLifecycle(
  owner: Owner,
  options: SceneMountOptions,
  measure: Measure,
  setFocus: SetFocus,
  reportAsync: (error: unknown) => void,
): void {
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
  const acceptedProperties = new Map<number, PreparedProperties>();
  let activated = false;
  const dynamicRefs = new Map<number, { value: unknown; dispose?: () => void }>();
  const updateRefs = (properties: readonly PreparedProperties[]): void => {
    for (const prepared of properties) {
      const index = prepared.write.node;
      let entry = dynamicRefs.get(index);
      if (!entry) {
        entry = { value: undefined };
        dynamicRefs.set(index, entry);
        cleanup(owner.entityId, () => entry!.dispose?.());
      }
      if (Object.is(entry.value, prepared.ref)) continue;
      entry.dispose?.();
      entry.dispose = undefined;
      entry.value = prepared.ref;
      if (owner.mounted && !owner.disposed) {
        entry.dispose = mountRef(
          elementHandle(owner, index, measure, setFocus, reportAsync),
          prepared.ref as RefValue<SceneElement>,
        );
      }
    }
  };
  owner.acceptPropertyRefs = (properties) => {
    for (const prepared of properties) acceptedProperties.set(prepared.write.node, prepared);
    if (activated && owner.mounted && !owner.disposed) updateRefs(properties);
  };
  owner.activate = () => {
    if (owner.disposed || !owner.mounted) return;
    // Bind refs before effect callbacks, so effects can use accepted handles.
    for (const ref of options.refs ?? []) {
      const node = owner.template.nodes[ref.node];
      if (!node || node.kind !== 'element') throw new Error('Desktop ref requires an element');
      const element = elementHandle(owner, ref.node, measure, setFocus, reportAsync);
      cleanup(owner.entityId, mountRef(element, ref.value));
    }
    activated = true;
    updateRefs([...acceptedProperties.values()]);
    options.activate?.(owner.instance);
  };
}

function elementHandle(
  owner: Owner,
  index: number,
  measure: Measure,
  setFocus: SetFocus,
  reportAsync: (error: unknown) => void,
): SceneElement {
  const node = owner.template.nodes[index];
  if (!node || node.kind !== 'element') throw new Error('Desktop ref requires an element');
  const connected = (): void => {
    if (!owner.mounted || owner.disposed) throw new Error('Cannot use a disconnected desktop element');
  };
  const changeFocus = (focused: boolean, preventScroll = false): void => {
    // HTMLElement focus/blur return void and disconnected elements are inert.
    // Transport acknowledgment belongs to the adapter, never to author code.
    if (!owner.mounted || owner.disposed) return;
    void setFocus(owner.instance.handle, index, focused, preventScroll).catch(reportAsync);
  };
  const element: SceneElement = Object.freeze({
    handle: owner.instance.handle,
    node: index,
    tagName: node.tag.toUpperCase(),
    ownerDocument: null,
    focus(options?: FocusOptions) {
      changeFocus(true, Boolean(options?.preventScroll));
    },
    blur: () => changeFocus(false),
    async measure() {
      connected();
      const result = await measure(owner.instance.handle, index);
      // Retirement can race with a read already sent to the native process.
      connected();
      return result;
    },
    get isConnected() {
      return owner.mounted && !owner.disposed;
    },
    get id() {
      return (owner.acknowledgedProperties.get(index)?.attributes ?? node.attributes)?.id ?? '';
    },
    get value() {
      const slot = owner.template.slots.findIndex(
        (slot) => slot.node === index && slot.type === 'value',
      );
      return slot < 0
        ? ((owner.acknowledgedProperties.get(index)?.attributes ?? node.attributes)?.value ?? '')
        : (owner.acknowledged.get(slot) ?? '');
    },
    getAttribute(name: string) {
      return (
        (owner.acknowledgedProperties.get(index)?.attributes ?? node.attributes)?.[name] ?? null
      );
    },
  });
  return element;
}
