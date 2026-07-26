/**
 * Legacy hand-compiled counter fixture retained for runtime regression tests.
 * A HAND-COMPILED component — what the M5 compiler will emit from a plain
 * component. Refactored in M1 to route every dynamic write through the
 * setter helpers.
 */
import { register, markDirty, type EntityId } from '@memoized-dom/runtime';
import { setText, type SlotCache } from '@memoized-dom/runtime';

export function Counter(id: EntityId, parent: EntityId | null = null): HTMLButtonElement {
  // ---- state: component-local, private to this instance -------------------
  let count = 0;

  // ---- creation branch (runs once) ----------------------------------------
  const $: SlotCache = {};

  const button = document.createElement('button');
  button.append('count: ');
  const t = document.createTextNode('');
  setText($, 'v1', t, count); // creation = first update-branch run: seeds cache
  button.appendChild(t);

  button.onclick = () => {
    count++;
    markDirty(id); // <- compiler-generated in the future; invisible to the user
  };

  // ---- entity registration: the update branch ------------------------------
  register({
    id,
    parent,
    render() {
      setText($, 'v1', t, count); // guarded: no DOM write when count unchanged
    },
  });

  return button;
}
