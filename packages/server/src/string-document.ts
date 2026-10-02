/**
 * string-document.ts — Phase 4 Direct String-Writer Document Tier.
 *
 * Provides a lightweight DocumentLike implementation designed for ultra-fast
 * server rendering without allocating heavyweight DOM element trees.
 */

import type { DocumentLike } from '@memoized-dom/runtime';
import { parseMarkup, type MarkupChild } from '@memoized-dom/runtime/server';

const TEXT_ESCAPE = /[&<>]/;
const ATTRIBUTE_ESCAPE = /[&"<>]/;

// Most text and attribute values need no escaping; test once before paying
// for replacement passes.
function escapeHtml(text: string): string {
  if (!TEXT_ESCAPE.test(text)) return text;
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  if (!ATTRIBUTE_ESCAPE.test(value)) return value;
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const INVALID_ATTRIBUTE_NAME = /[\0-\x20\x7F"'`/<> =]/u;
const INVALID_ELEMENT_NAME = /[\0-\x20\x7F"'`/<> =]/u;

interface TagInfo {
  readonly tag: string;
  readonly isVoid: boolean;
}

// Tag vocabularies are small; validate and normalize each name once.
const TAG_INFO = new Map<string, TagInfo>();

function tagInfo(name: string): TagInfo {
  let info = TAG_INFO.get(name);
  if (info === undefined) {
    if (name.length === 0 || INVALID_ELEMENT_NAME.test(name)) {
      throw new DOMException(`Invalid element name: ${JSON.stringify(name)}`, 'InvalidCharacterError');
    }
    const tag = name.toLowerCase();
    info = { tag, isVoid: VOID_TAGS.has(tag) };
    TAG_INFO.set(name, info);
  }
  return info;
}

function assertAttributeName(name: string): string {
  if (name.length === 0 || INVALID_ATTRIBUTE_NAME.test(name)) {
    throw new DOMException(`Invalid attribute name: ${JSON.stringify(name)}`, 'InvalidCharacterError');
  }
  return name;
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

export interface StringRenderableNode {
  nodeType: number;
  parentNode: StringRenderableNode | null;
  firstChild: StringRenderableNode | null;
  lastChild: StringRenderableNode | null;
  previousSibling: StringRenderableNode | null;
  nextSibling: StringRenderableNode | null;
  textContent: string | null;
  outerHTML?: string;
  appendChild(child: StringRenderableNode): StringRenderableNode;
  insertBefore(newNode: StringRenderableNode, referenceNode: StringRenderableNode | null): StringRenderableNode;
  removeChild(child: StringRenderableNode): StringRenderableNode;
  cloneNode(deep?: boolean): StringRenderableNode;
  toString(markers: boolean): string;
}

/**
 * Children are an intrusive doubly linked list (DOM pointer shape), so
 * append, insert, and remove are O(1) and moving a fragment splices its whole
 * chain in one pass. Array-backed children made every list row insertion
 * O(N) in `indexOf`/`splice`/relink work, and large lists O(N²).
 */
abstract class StringContainer {
  parentNode: StringRenderableNode | null = null;
  previousSibling: StringRenderableNode | null = null;
  nextSibling: StringRenderableNode | null = null;
  firstChild: StringRenderableNode | null = null;
  lastChild: StringRenderableNode | null = null;

  get childNodes(): StringRenderableNode[] {
    const nodes: StringRenderableNode[] = [];
    for (let child = this.firstChild; child !== null; child = child.nextSibling) {
      nodes.push(child);
    }
    return nodes;
  }

  hasChildNodes(): boolean {
    return this.firstChild !== null;
  }

  appendChild(child: StringRenderableNode): StringRenderableNode {
    return this.insert(child, null);
  }

  insertBefore(newNode: StringRenderableNode, refNode: StringRenderableNode | null): StringRenderableNode {
    // An unowned reference appends rather than throwing NotFoundError.
    return this.insert(newNode, refNode !== null && refNode.parentNode === this.node ? refNode : null);
  }

  removeChild(child: StringRenderableNode): StringRenderableNode {
    if (child.parentNode === this.node) this.unlink(child);
    return child;
  }

  private get node(): StringRenderableNode {
    return this as unknown as StringRenderableNode;
  }

  protected clearChildren(): void {
    for (let child = this.firstChild; child !== null;) {
      const next = child.nextSibling;
      child.parentNode = child.previousSibling = child.nextSibling = null;
      child = next;
    }
    this.firstChild = this.lastChild = null;
  }

  private insert(node: StringRenderableNode, ref: StringRenderableNode | null): StringRenderableNode {
    if (node === ref || (node as unknown) === this) return node;
    if (node.nodeType === 11 /* FRAGMENT */) {
      this.spliceFragment(node as unknown as StringContainer, ref);
      return node;
    }
    if (node.parentNode !== null) node.parentNode.removeChild(node);
    const previous = ref === null ? this.lastChild : ref.previousSibling;
    node.parentNode = this as unknown as StringRenderableNode;
    node.previousSibling = previous;
    node.nextSibling = ref;
    if (previous === null) this.firstChild = node;
    else previous.nextSibling = node;
    if (ref === null) this.lastChild = node;
    else ref.previousSibling = node;
    return node;
  }

  private spliceFragment(fragment: StringContainer, ref: StringRenderableNode | null): void {
    const first = fragment.firstChild;
    const last = fragment.lastChild;
    if (first === null || last === null) return;
    const parent = this as unknown as StringRenderableNode;
    for (let child: StringRenderableNode | null = first; child !== null; child = child.nextSibling) {
      child.parentNode = parent;
    }
    fragment.firstChild = fragment.lastChild = null;
    const previous = ref === null ? this.lastChild : ref.previousSibling;
    first.previousSibling = previous;
    last.nextSibling = ref;
    if (previous === null) this.firstChild = first;
    else previous.nextSibling = first;
    if (ref === null) this.lastChild = last;
    else ref.previousSibling = last;
  }

  private unlink(child: StringRenderableNode): void {
    const previous = child.previousSibling;
    const next = child.nextSibling;
    if (previous === null) this.firstChild = next;
    else previous.nextSibling = next;
    if (next === null) this.lastChild = previous;
    else next.previousSibling = previous;
    child.parentNode = child.previousSibling = child.nextSibling = null;
  }
}

export class StringComment implements StringRenderableNode {
  readonly nodeType = 8;
  parentNode: StringRenderableNode | null = null;
  firstChild: StringRenderableNode | null = null;
  lastChild: StringRenderableNode | null = null;
  previousSibling: StringRenderableNode | null = null;
  nextSibling: StringRenderableNode | null = null;
  textContent = '';

  constructor(public data: string) {}

  appendChild(child: StringRenderableNode): StringRenderableNode {
    return child;
  }

  insertBefore(node: StringRenderableNode): StringRenderableNode {
    return node;
  }

  removeChild(child: StringRenderableNode): StringRenderableNode {
    return child;
  }

  cloneNode(): StringRenderableNode {
    return new StringComment(this.data);
  }

  toString(markers: boolean): string {
    if (!markers || this.data.includes('-->') || this.data.endsWith('-')) return '';
    return `<!--${this.data}-->`;
  }
}

export class StringText implements StringRenderableNode {
  readonly nodeType = 3;
  parentNode: StringRenderableNode | null = null;
  firstChild: StringRenderableNode | null = null;
  lastChild: StringRenderableNode | null = null;
  previousSibling: StringRenderableNode | null = null;
  nextSibling: StringRenderableNode | null = null;
  private _value: string;

  constructor(initial = '') {
    this._value = initial;
  }

  get textContent(): string {
    return this._value;
  }

  set textContent(v: string) {
    this._value = v;
  }

  get data(): string {
    return this._value;
  }

  set data(v: string) {
    this._value = v;
  }

  appendChild(child: StringRenderableNode): StringRenderableNode {
    return child;
  }

  insertBefore(node: StringRenderableNode): StringRenderableNode {
    return node;
  }

  removeChild(child: StringRenderableNode): StringRenderableNode {
    return child;
  }

  cloneNode(): StringRenderableNode {
    return new StringText(this._value);
  }

  toString(): string {
    return escapeHtml(this._value ?? '');
  }
}

export class StringElement extends StringContainer implements StringRenderableNode {
  readonly nodeType = 1;

  className = '';
  innerHTML?: string;

  private readonly info: TagInfo;
  // Most elements carry neither attributes nor inline style; allocate lazily.
  private ownAttributes: Map<string, string> | null = null;
  private ownStyle: (Record<string, string> & { cssText?: string }) | null = null;

  constructor(public readonly tagName: string, public readonly namespaceURI: string = HTML_NAMESPACE) {
    super();
    this.info = tagInfo(tagName);
  }

  get attributes(): Map<string, string> {
    return this.ownAttributes ??= new Map();
  }

  get style(): Record<string, string> & { cssText?: string } {
    return this.ownStyle ??= {};
  }

  set style(value: Record<string, string> & { cssText?: string }) {
    this.ownStyle = value;
  }

  get textContent(): string {
    let text = '';
    for (let child = this.firstChild; child !== null; child = child.nextSibling) {
      text += child.textContent ?? '';
    }
    return text;
  }

  set textContent(text: string) {
    this.clearChildren();
    if (text !== '') {
      this.appendChild(new StringText(text));
    }
  }

  setAttribute(name: string, value: string): void {
    assertAttributeName(name);
    // HTML attribute names are case-insensitive; foreign (SVG/MathML) names
    // such as `viewBox` are not.
    this.attributes.set(this.isHtml ? name.toLowerCase() : name, String(value));
  }

  private get isHtml(): boolean {
    return this.namespaceURI === HTML_NAMESPACE;
  }

  setAttributeNS(_namespace: string | null, qualifiedName: string, value: string): void {
    this.setAttribute(qualifiedName, value);
  }

  getAttribute(name: string): string | null {
    if (name.length === 0 || INVALID_ATTRIBUTE_NAME.test(name)) return null;
    return this.ownAttributes?.get(this.isHtml ? name.toLowerCase() : name) ?? null;
  }

  removeAttribute(name: string): void {
    if (name.length === 0 || INVALID_ATTRIBUTE_NAME.test(name)) return;
    this.ownAttributes?.delete(this.isHtml ? name.toLowerCase() : name);
  }

  hasAttribute(name: string): boolean {
    if (name.length === 0 || INVALID_ATTRIBUTE_NAME.test(name)) return false;
    return this.ownAttributes?.has(this.isHtml ? name.toLowerCase() : name) ?? false;
  }

  /**
   * Compiled JSX lowers form state (`value`, `checked`, `disabled`, ...) to
   * property writes. A string element has no live state to hold them, so
   * reflect them into serialized attributes exactly like the LinkeDOM tier
   * (whose renderer also syncs non-reflecting booleans such as `checked`).
   */
  get value(): string {
    return this.info.tag === 'textarea' ? this.textContent : this.getAttribute('value') ?? '';
  }

  set value(value: unknown) {
    const text = value == null ? '' : String(value);
    if (this.info.tag === 'textarea') this.textContent = text;
    else this.setAttribute('value', text);
  }

  get tabIndex(): number {
    return Number(this.getAttribute('tabindex') ?? -1);
  }

  set tabIndex(value: unknown) {
    this.setAttribute('tabindex', String(value));
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  cloneNode(deep = false): StringRenderableNode {
    const clone = new StringElement(this.tagName, this.namespaceURI);
    clone.className = this.className;
    if (this.ownStyle !== null) clone.ownStyle = { ...this.ownStyle };
    clone.innerHTML = this.innerHTML;
    if (this.ownAttributes !== null && this.ownAttributes.size > 0) {
      clone.ownAttributes = new Map(this.ownAttributes);
    }
    if (deep) {
      for (let child = this.firstChild; child !== null; child = child.nextSibling) {
        clone.appendChild(child.cloneNode(true));
      }
    }
    return clone;
  }

  override toString(markers: boolean): string {
    const tag = this.info.tag;
    const className = this.className;
    const cssText = this.ownStyle?.cssText;
    let out = '<' + tag;

    if (className !== '') {
      out += ' class="' + escapeAttribute(className) + '"';
    }
    if (cssText) {
      out += ' style="' + escapeAttribute(cssText) + '"';
    }
    if (this.ownAttributes !== null) {
      for (const [key, val] of this.ownAttributes) {
        if (key === 'class' && className !== '') continue;
        if (key === 'style' && cssText) continue;
        out += val === '' ? ' ' + key : ' ' + key + '="' + escapeAttribute(val) + '"';
      }
    }
    out += '>';

    if (this.info.isVoid && this.firstChild === null) return out;

    if (this.innerHTML !== undefined) {
      out += this.innerHTML;
    } else {
      for (let child = this.firstChild; child !== null; child = child.nextSibling) {
        out += child.toString(markers);
      }
    }
    return out + '</' + tag + '>';
  }
}

export class StringFragment extends StringContainer implements StringRenderableNode {
  readonly nodeType = 11;
  textContent: string | null = null;

  cloneNode(deep = false): StringRenderableNode {
    const clone = new StringFragment();
    if (deep) {
      for (let child = this.firstChild; child !== null; child = child.nextSibling) {
        clone.appendChild(child.cloneNode(true));
      }
    }
    return clone;
  }

  override toString(markers: boolean): string {
    let out = '';
    for (let child = this.firstChild; child !== null; child = child.nextSibling) {
      out += child.toString(markers);
    }
    return out;
  }
}

/**
 * One retained leaf extent, with no interior server nodes. The compiler owns
 * escaping and the writer closure reads already-evaluated slot snapshots.
 * List anchors and reconciliation still use the ordinary pointer operations.
 */
class StringHtmlChunk extends StringContainer implements StringRenderableNode {
  readonly nodeType = 1;
  textContent: string | null = null;

  constructor(private readonly write: () => string) { super(); }

  cloneNode(): StringRenderableNode {
    const snapshot = this.write();
    return new StringHtmlChunk(() => snapshot);
  }

  override toString(): string { return this.write(); }
}

const HTML_WRITER: NonNullable<DocumentLike['htmlWriter']> = Object.freeze({
  create: (write: () => string) => new StringHtmlChunk(write) as unknown as Node,
  text: escapeHtml,
  classAttribute: (value: string) => value === '' ? '' : ' class="' + escapeAttribute(value) + '"',
});

const REFLECTED_BOOLEANS: ReadonlyArray<readonly [property: string, attribute: string]> = [
  ['checked', 'checked'],
  ['disabled', 'disabled'],
  ['selected', 'selected'],
  ['readOnly', 'readonly'],
  ['multiple', 'multiple'],
  ['required', 'required'],
  ['open', 'open'],
  ['hidden', 'hidden'],
  ['muted', 'muted'],
  ['controls', 'controls'],
  ['loop', 'loop'],
  ['autoFocus', 'autofocus'],
  ['autoPlay', 'autoplay'],
];

for (const [property, attribute] of REFLECTED_BOOLEANS) {
  Object.defineProperty(StringElement.prototype, property, {
    configurable: true,
    get(this: StringElement) {
      return this.hasAttribute(attribute);
    },
    set(this: StringElement, value: unknown) {
      if (value) this.setAttribute(attribute, '');
      else this.removeAttribute(attribute);
    },
  });
}

// Markup segments are compiler-emitted module constants, so the set is bounded
// by application code. Parsed descriptors are read-only; reuse them across
// requests instead of re-parsing every segment on every render.
const PARSED_MARKUP = new Map<string, readonly MarkupChild[]>();

export class StringDocument implements DocumentLike {
  readonly htmlWriter = HTML_WRITER;

  createComment(data: string): Comment {
    return new StringComment(data) as unknown as Comment;
  }

  createElement(tagName: string): Element {
    return new StringElement(tagName) as unknown as Element;
  }

  createElementNS(namespaceURI: string, qualifiedName: string): Element {
    return new StringElement(qualifiedName, namespaceURI) as unknown as Element;
  }

  createTextNode(data: string): Text {
    return new StringText(data) as unknown as Text;
  }

  createDocumentFragment(): DocumentFragment {
    return new StringFragment() as unknown as DocumentFragment;
  }

  /**
   * Interpret compiler-generated markup through StringNode factories so
   * emitted markup segments serialize identically to imperative creation.
   * Returns nodes in compiler creation order (post-order; root last).
   */
  materializeMarkup(markup: string): Node[] {
    const output: Node[] = [];
    const build = (node: MarkupChild): Node => {
      if (node.type === 'text') {
        const text = this.createTextNode(node.text) as unknown as Node;
        output.push(text);
        return text;
      }
      const element =
        node.ns === HTML_NAMESPACE
          ? this.createElement(node.tag)
          : this.createElementNS(node.ns, node.tag);
      for (const [name, value] of node.attrs) {
        element.setAttribute(name, value);
      }
      for (const child of node.children) {
        element.appendChild(build(child));
      }
      output.push(element as unknown as Node);
      return element as unknown as Node;
    };
    let parsed = PARSED_MARKUP.get(markup);
    if (parsed === undefined) {
      parsed = parseMarkup(markup);
      PARSED_MARKUP.set(markup, parsed);
    }
    for (const child of parsed) {
      build(child);
    }
    return output;
  }

  getElementById(): Element | null {
    return null;
  }
}
