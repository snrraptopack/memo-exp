/**
 * dom-props.ts - ordered JSX spread-property patching.
 *
 * Elements containing a spread are patched as one ordered object so later
 * explicit or spread values override earlier ones exactly as authored.
 * Unknown spread event handlers receive a root fallback on normal completion;
 * explicit compiler-instrumented handlers can be marked safe by key.
 */

import { markDirtySubtree } from './kernel';
import { classValue, setClassValue, setStyleValue } from './dom-values';

interface EventRecord {
  source: EventListener;
  listener: EventListener;
  type: string;
}

const propSnapshots = new WeakMap<Element, Map<string, unknown>>();
const eventSnapshots = new WeakMap<Element, Map<string, EventRecord>>();
const HTML_PROPERTIES = new Set([
  'innerHTML',
  'checked',
  'value',
  'selected',
  'disabled',
  'hidden',
  'multiple',
  'required',
  'readOnly',
  'muted',
  'open',
  'controls',
  'loop',
  'autoFocus',
  'autoPlay',
  'tabIndex',
]);
const ATTRIBUTE_NAMES: Record<string, string> = {
  className: 'class',
  htmlFor: 'for',
  readOnly: 'readonly',
  autoFocus: 'autofocus',
  autoPlay: 'autoplay',
  tabIndex: 'tabindex',
  crossOrigin: 'crossorigin',
};
const SVG_ATTRIBUTE_NAMES: Record<string, string> = {
  className: 'class',
  clipPath: 'clip-path',
  clipRule: 'clip-rule',
  colorInterpolation: 'color-interpolation',
  colorInterpolationFilters: 'color-interpolation-filters',
  dominantBaseline: 'dominant-baseline',
  fillOpacity: 'fill-opacity',
  fillRule: 'fill-rule',
  floodColor: 'flood-color',
  floodOpacity: 'flood-opacity',
  fontFamily: 'font-family',
  fontSize: 'font-size',
  markerEnd: 'marker-end',
  markerMid: 'marker-mid',
  markerStart: 'marker-start',
  stopColor: 'stop-color',
  stopOpacity: 'stop-opacity',
  strokeDasharray: 'stroke-dasharray',
  strokeDashoffset: 'stroke-dashoffset',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  strokeMiterlimit: 'stroke-miterlimit',
  strokeOpacity: 'stroke-opacity',
  strokeWidth: 'stroke-width',
  textAnchor: 'text-anchor',
  vectorEffect: 'vector-effect',
  xlinkHref: 'xlink:href',
};
const EVENT_NAMES: Record<string, string> = {
  doubleclick: 'dblclick',
};

/** Patch all properties represented by one ordered spread object. */
export function patchDomProps(
  element: Element,
  nextValue: unknown,
  eventRootId: string,
  safeEventKeys: readonly string[] = [],
): void {
  const next =
    nextValue !== null && typeof nextValue === 'object'
      ? (nextValue as Record<string, unknown>)
      : {};
  const previous = propSnapshots.get(element) ?? new Map<string, unknown>();
  const safeEvents = new Set(safeEventKeys);

  for (const name of previous.keys()) {
    if (!Object.prototype.hasOwnProperty.call(next, name)) {
      applyDomProp(element, name, null, previous, eventRootId, safeEvents);
    }
  }
  for (const [name, value] of Object.entries(next)) {
    applyDomProp(element, name, value, previous, eventRootId, safeEvents);
  }

  const snapshot = new Map<string, unknown>();
  for (const [name, value] of Object.entries(next)) {
    snapshot.set(name, snapshotValue(name, value));
  }
  propSnapshots.set(element, snapshot);
}

/** Set one mapped JSX DOM value outside a spread-bearing element. */
export function setDomValue(
  element: Element,
  name: string,
  value: unknown,
): void {
  if (name === 'class' || name === 'className') {
    setClassValue(element, value);
    return;
  }
  if (name === 'style') {
    setStyleValue(element, value);
    return;
  }
  setScalarDomValue(element, name, value);
}

function applyDomProp(
  element: Element,
  name: string,
  value: unknown,
  previous: Map<string, unknown>,
  eventRootId: string,
  safeEvents: Set<string>,
): void {
  if (name === 'key' || name === 'children') return;
  if (/^on[A-Z]/.test(name)) {
    setEvent(
      element,
      name,
      typeof value === 'function' ? (value as EventListener) : null,
      eventRootId,
      safeEvents.has(name),
    );
    return;
  }
  const normalized = snapshotValue(name, value);
  if (Object.is(previous.get(name), normalized)) return;
  setDomValue(element, name, value);
}

function snapshotValue(name: string, value: unknown): unknown {
  if (name === 'class' || name === 'className') return classValue(value);
  if (name === 'style') return Symbol('style-snapshot');
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return String(value);
}

function setEvent(
  element: Element,
  key: string,
  source: EventListener | null,
  rootId: string,
  safe: boolean,
): void {
  let records = eventSnapshots.get(element);
  if (records === undefined) {
    records = new Map();
    eventSnapshots.set(element, records);
  }
  const existing = records.get(key);
  if (existing?.source === source) return;
  if (existing !== undefined) {
    element.removeEventListener(existing.type, existing.listener);
    records.delete(key);
  }
  if (source === null) return;

  const type = eventType(key);
  const listener = safe
    ? source
    : function spreadEvent(this: Element, event: Event): unknown {
        const result = source.call(this, event);
        markDirtySubtree(rootId);
        if (
          result !== null &&
          typeof result === 'object' &&
          'then' in result &&
          typeof (result as PromiseLike<unknown>).then === 'function'
        ) {
          (result as PromiseLike<unknown>).then(() => {
            markDirtySubtree(rootId);
          });
        }
        return result;
      };
  element.addEventListener(type, listener);
  records.set(key, { source, listener, type });
}

function eventType(key: string): string {
  const lowered = key.slice(2).toLowerCase();
  return EVENT_NAMES[lowered] ?? lowered;
}

function setScalarDomValue(
  element: Element,
  name: string,
  value: unknown,
): void {
  const html = element.namespaceURI !== 'http://www.w3.org/2000/svg';
  if (html && HTML_PROPERTIES.has(name)) {
    if (name === 'tabIndex' && value == null) {
      element.removeAttribute('tabindex');
      return;
    }
    (element as unknown as Record<string, unknown>)[name] =
      value == null ? propertyEmptyValue(name) : value;
    return;
  }

  const attrName = html
    ? ATTRIBUTE_NAMES[name] ?? name
    : SVG_ATTRIBUTE_NAMES[name] ?? ATTRIBUTE_NAMES[name] ?? name;
  if (value == null || value === false) {
    element.removeAttribute(attrName);
  } else if (value === true) {
    element.setAttribute(attrName, '');
  } else if (!html && name === 'xlinkHref') {
    element.setAttributeNS(
      'http://www.w3.org/1999/xlink',
      'xlink:href',
      String(value),
    );
  } else {
    element.setAttribute(attrName, String(value));
  }
}

function propertyEmptyValue(name: string): unknown {
  return name === 'value' || name === 'innerHTML' ? '' : false;
}
