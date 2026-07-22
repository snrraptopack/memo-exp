/**
 * @file setters.ts
 * M1 — Value-cached setter helpers.
 *
 * Every dynamic DOM write in compiled output goes through one of these.
 * The guard (previous-value comparison) lives HERE, in one place, instead of
 * being emitted inline at every call site.
 *
 * Contract with the compiler (M5):
 *   - each dynamic slot gets a unique cache key within the component's `$`
 *   - the creation branch calls the SAME helpers as the update branch, so the
 *     value cache is always seeded with exactly what was written
 *     (the invariant M0's failing test taught us — now structural, not a rule)
 *
 * Semantics:
 *   - guards use strict equality on the RAW value (===)
 *   - NaN never compares equal -> always writes (documented, acceptable)
 *   - objects compare by identity -> new reference means "changed"
 */

export type SlotCache = Record<string, unknown>;

/** Text node data. null/undefined/booleans render as empty string (JSX semantics). */
export function setText(
  $: SlotCache,
  key: string,
  node: Text,
  value: unknown,
): void {
  if ($[key] === value) return;
  $[key] = value;
  node.data = value == null || typeof value === 'boolean' ? '' : String(value);
}

/** Full className string replacement. */
export function setClassName(
  $: SlotCache,
  key: string,
  el: HTMLElement,
  value: string,
): void {
  if ($[key] === value) return;
  $[key] = value;
  el.className = value;
}

/** Toggle a single class by boolean condition. */
export function setClass(
  $: SlotCache,
  key: string,
  el: HTMLElement,
  name: string,
  cond: boolean,
): void {
  if ($[key] === cond) return;
  $[key] = cond;
  el.classList.toggle(name, cond);
}

/**
 * Attribute write.
 * null / undefined / false -> attribute removed.
 * true -> present with empty value (HTML boolean-attribute convention).
 */
export function setAttr(
  $: SlotCache,
  key: string,
  el: Element,
  name: string,
  value: unknown,
): void {
  if ($[key] === value) return;
  $[key] = value;
  if (value == null || value === false) el.removeAttribute(name);
  else if (value === true) el.setAttribute(name, '');
  else el.setAttribute(name, String(value));
}

/**
 * DOM property write (input.value, checkbox.checked, ...).
 * Bypasses attributes entirely — for state that lives on the element object.
 */
export function setProp(
  $: SlotCache,
  key: string,
  obj: object,
  prop: string,
  value: unknown,
): void {
  if ($[key] === value) return;
  $[key] = value;
  (obj as Record<string, unknown>)[prop] = value;
}

/**
 * Inline style property (kebab-case name, e.g. 'background-color').
 * null / undefined -> property removed.
 */
export function setStyle(
  $: SlotCache,
  key: string,
  el: HTMLElement,
  prop: string,
  value: string | null | undefined,
): void {
  if ($[key] === value) return;
  $[key] = value;
  if (value == null) el.style.removeProperty(prop);
  else el.style.setProperty(prop, value);
}

/**
 * R13: change detection for computeds. Scalars compare by Object.is;
 * arrays compare element-wise (Object.is) — a re-derivation that produces
 * the same contents does NOT propagate downstream. Everything else
 * (objects, null transitions, type changes) counts as changed.
 */
export function computedChanged(prev: unknown, next: unknown): boolean {
  if (Object.is(prev, next)) return false;
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length !== next.length) return true;
    for (let i = 0; i < prev.length; i++) {
      if (!Object.is(prev[i], next[i])) return true;
    }
    return false;
  }
  return true;
}
