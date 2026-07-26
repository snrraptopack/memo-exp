/**
 * dom-values.ts - normalization and snapshot updates for JSX class/style.
 *
 * Mutable arrays and objects may retain identity between renders. These
 * helpers compare normalized snapshots rather than references, preserving
 * guarded DOM writes without requiring compiler knowledge of their methods.
 */

type ClassRecord = Record<string, unknown>;
type StyleRecord = Record<string, string | number | null | undefined>;

const styleSnapshots = new WeakMap<Element, Map<string, string>>();
const UNITLESS = new Set([
  'animation-iteration-count',
  'border-image-outset',
  'border-image-slice',
  'border-image-width',
  'column-count',
  'flex',
  'flex-grow',
  'flex-shrink',
  'font-weight',
  'grid-column',
  'grid-row',
  'line-height',
  'opacity',
  'order',
  'orphans',
  'scale',
  'tab-size',
  'widows',
  'z-index',
  'zoom',
]);

/** Normalize strings, nested arrays, and conditional class objects. */
export function classValue(value: unknown): string {
  const names: string[] = [];
  appendClass(value, names);
  return names.join(' ');
}

/** Apply a normalized class value to HTML or SVG elements. */
export function setClassValue(element: Element, value: unknown): void {
  const normalized = classValue(value);
  if (element.namespaceURI === 'http://www.w3.org/2000/svg') {
    if (normalized === '') element.removeAttribute('class');
    else element.setAttribute('class', normalized);
  } else {
    (element as HTMLElement).className = normalized;
  }
}

/** Diff a string or object style value against a content snapshot. */
export function setStyleValue(element: Element, value: unknown): void {
  const style = (element as HTMLElement).style;
  if (style === undefined) return;

  if (typeof value === 'string') {
    const previous = styleSnapshots.get(element);
    if (
      previous?.size === 1 &&
      previous.get('$cssText') === value
    ) {
      return;
    }
    style.cssText = value;
    styleSnapshots.set(element, new Map([['$cssText', value]]));
    return;
  }

  const next = new Map<string, string>();
  if (value !== null && typeof value === 'object') {
    for (const [rawName, rawValue] of Object.entries(value as StyleRecord)) {
      if (rawValue == null) continue;
      const name = styleName(rawName);
      next.set(name, styleValue(name, rawValue));
    }
  }

  const previous = styleSnapshots.get(element) ?? new Map<string, string>();
  if (previous.has('$cssText')) style.cssText = '';
  for (const name of previous.keys()) {
    if (name !== '$cssText' && !next.has(name)) style.removeProperty(name);
  }
  for (const [name, normalized] of next) {
    if (previous.get(name) !== normalized) {
      style.setProperty(name, normalized);
    }
  }
  styleSnapshots.set(element, next);
}

function appendClass(value: unknown, names: string[]): void {
  if (value == null || value === false || value === true) return;
  if (Array.isArray(value)) {
    for (const item of value) appendClass(item, names);
    return;
  }
  if (typeof value === 'object') {
    for (const [name, enabled] of Object.entries(value as ClassRecord)) {
      if (enabled) names.push(name);
    }
    return;
  }
  const text = String(value).trim();
  if (text !== '') names.push(text);
}

function styleName(name: string): string {
  if (name.startsWith('--') || name.includes('-')) return name;
  return name
    .replace(/^ms([A-Z])/, 'ms-$1')
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function styleValue(name: string, value: string | number): string {
  if (
    typeof value === 'number' &&
    value !== 0 &&
    !name.startsWith('--') &&
    !UNITLESS.has(name)
  ) {
    return `${value}px`;
  }
  return String(value);
}
