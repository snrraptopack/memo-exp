/** Read one ordered JSX property bag before entering native publication. */
import capabilities from '../scene/capabilities.json';
import type { CssDeclaration } from '../scene/schema';
import type { PropertyWrite } from '../bridge/protocol';
import type { SceneHandler, ScenePropertyBinding } from './application';
import { textValue } from './values';
import { sceneEventNames, readPropertyEvent } from './property-events';

/** Normalize each spread separately so aliases obey authored override order. */
export function sceneAttributes(value: unknown): Record<string, unknown> {
  const copied = { ...(value as Record<string, unknown>) };
  const result = Object.create(null) as Record<string, unknown>;
  for (const [name, item] of Object.entries(copied)) {
    const canonical = name === 'className' ? 'class' : name === 'onInput' ? 'onChange' : name;
    result[canonical] = item;
  }
  return result;
}

export interface PreparedProperties {
  readonly write: PropertyWrite;
  readonly handlers: ReadonlyMap<number, SceneHandler>;
  readonly ref: unknown;
}

const unitless = new Set(['opacity', 'line-height', 'font-weight', 'flex-grow', 'flex-shrink']);

function styleValue(value: unknown): readonly CssDeclaration[] | string {
  if (value == null || value === false) return [];
  // String styles go through the existing native CSS declaration parser.
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Desktop style requires a CSS string or property object');
  }
  const declarations: CssDeclaration[] = [];
  for (const [name, item] of Object.entries(value)) {
    if (item == null || item === false) continue;
    if (typeof item !== 'string' && typeof item !== 'number') {
      throw new TypeError(`Desktop style ${name} requires a string or number`);
    }
    const property = name.startsWith('--')
      ? name
      : name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    declarations.push({
      property,
      value:
        typeof item === 'number' && item !== 0 && !unitless.has(property)
          ? `${item}px`
          : String(item),
    });
  }
  return declarations;
}

export function readProperties(binding: ScenePropertyBinding, tag: string): PreparedProperties {
  const attributes = Object.create(null) as Record<string, string>;
  const handlers = new Map<number, SceneHandler>();
  let style: readonly CssDeclaration[] | string = [];
  let ref: unknown;
  const capability = (
    capabilities.tags as Record<string, { attributes: string[]; events: string[] }>
  )[tag];
  if (!capability) throw new TypeError(`Unsupported desktop tag <${tag}>`);
  const bag = binding.read();
  for (const [name, value] of Object.entries(bag)) {
    if (name === 'key') continue;
    if (name === 'ref') {
      validateRef(value);
      ref = value;
      continue;
    }
    if (Object.hasOwn(sceneEventNames, name)) {
      const handler = readPropertyEvent(name, value, tag, binding.events);
      if (handler) handlers.set(handler.site, handler.value);
      continue;
    }
    if (name === 'style') {
      style = styleValue(value);
      continue;
    }
    const allowed = capability.attributes.includes(name);
    if (!allowed) throw new TypeError(`Desktop attribute ${name} is not implemented on <${tag}>`);
    if (value == null || value === false) continue;
    attributes[name] = name === 'value' ? textValue(value) : scalarAttribute(name, value);
  }
  return { write: { node: binding.node, attributes, style }, handlers, ref };
}

function scalarAttribute(name: string, value: unknown): string {
  if (!['string', 'number', 'bigint', 'boolean'].includes(typeof value)) {
    throw new TypeError(`Desktop attribute ${name} requires a primitive value`);
  }
  return String(value);
}

export function sameProperties(a: PropertyWrite | undefined, b: PropertyWrite): boolean {
  if (!a) return false;
  const keys = Object.keys(a.attributes);
  return (
    keys.length === Object.keys(b.attributes).length &&
    keys.every((key) => a.attributes[key] === b.attributes[key]) &&
    sameStyle(a.style, b.style)
  );
}

function sameStyle(a: PropertyWrite['style'], b: PropertyWrite['style']): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return (
    a.length === b.length &&
    a.every(
      (entry, index) => entry.property === b[index]!.property && entry.value === b[index]!.value,
    )
  );
}

function validateRef(value: unknown): void {
  if (value == null || value === false || typeof value === 'function') return;
  if (Array.isArray(value)) {
    for (const entry of value) validateRef(entry);
    return;
  }
  throw new TypeError('Desktop ref requires a callback or an array of callbacks');
}
