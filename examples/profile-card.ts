/**
 * @file profile-card.ts
 * HAND-COMPILED component exercising every M1 setter:
 *   setText (name), setClass (online dot), setAttr (data-status),
 *   setProp (input.value)
 *
 * Notice the shape: creation builds nodes, then the update branch is invoked
 * ONCE at mount to seed everything. One code path, no special-casing.
 */
import { register, markDirty, type EntityId } from '../src/kernel';
import { setText, setClass, setAttr, setProp, type SlotCache } from '../src/setters';

export function ProfileCard(
  id: EntityId,
  parent: EntityId | null = null,
  initialName = 'anon',
): HTMLDivElement {
  // ---- state ---------------------------------------------------------------
  let name = initialName;
  let online = false;

  // ---- creation branch ------------------------------------------------------
  const $: SlotCache = {};

  const root = document.createElement('div');
  const nameSpan = document.createElement('span');
  const nameText = document.createTextNode('');
  nameSpan.appendChild(nameText);

  const dot = document.createElement('i');
  dot.className = 'dot';

  const input = document.createElement('input');

  root.append(nameSpan, dot, input);

  // ---- update branch (shared by mount-seed and commits) ---------------------
  function update() {
    setText($, 'name', nameText, name);
    setClass($, 'online', dot, 'dot--on', online);
    setAttr($, 'status', root, 'data-status', online ? 'online' : 'offline');
    setProp($, 'val', input, 'value', name);
  }

  input.oninput = () => {
    name = input.value;
    markDirty(id);
  };

  dot.onclick = () => {
    online = !online;
    markDirty(id);
  };

  register({ id, parent, render: update });
  update(); // mount seed: same code path as every later commit

  return root;
}
