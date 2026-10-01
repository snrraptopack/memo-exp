/**
 * string-document.ts — Phase 4 Direct String-Writer Document Tier.
 *
 * Provides a lightweight DocumentLike implementation designed for ultra-fast
 * server rendering without allocating heavyweight DOM element trees.
 */

import type { DocumentLike } from '@memoized-dom/runtime';
import { parseMarkup, type MarkupChild } from '@memoized-dom/runtime/server';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const INVALID_ATTRIBUTE_NAME = /[\0-\x20\x7F"'`/<> =]/u;
const INVALID_ELEMENT_NAME = /[\0-\x20\x7F"'`/<> =]/u;

function assertElementName(name: string): string {
  if (name.length === 0 || INVALID_ELEMENT_NAME.test(name)) {
    throw new DOMException(`Invalid element name: ${JSON.stringify(name)}`, 'InvalidCharacterError');
  }
  return name;
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
    // Lenient like the previous tier: an unowned reference appends.
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

  readonly attributes = new Map<string, string>();
  className = '';
  style: Record<string, string> & { cssText?: string } = {};
  innerHTML?: string;

  constructor(public readonly tagName: string, public readonly namespaceURI: string = 'http://www.w3.org/1999/xhtml') {
    super();
    assertElementName(tagName);
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
    this.attributes.set(assertAttributeName(name).toLowerCase(), String(value));
  }

  setAttributeNS(_namespace: string | null, qualifiedName: string, value: string): void {
    this.setAttribute(qualifiedName, value);
  }

  getAttribute(name: string): string | null {
    if (name.length === 0 || INVALID_ATTRIBUTE_NAME.test(name)) return null;
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  removeAttribute(name: string): void {
    if (name.length === 0 || INVALID_ATTRIBUTE_NAME.test(name)) return;
    this.attributes.delete(name.toLowerCase());
  }

  hasAttribute(name: string): boolean {
    if (name.length === 0 || INVALID_ATTRIBUTE_NAME.test(name)) return false;
    return this.attributes.has(name.toLowerCase());
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  cloneNode(deep = false): StringRenderableNode {
    const clone = new StringElement(this.tagName, this.namespaceURI);
    clone.className = this.className;
    clone.style = { ...this.style };
    clone.innerHTML = this.innerHTML;
    for (const [k, v] of this.attributes) {
      clone.attributes.set(k, v);
    }
    if (deep) {
      for (let child = this.firstChild; child !== null; child = child.nextSibling) {
        clone.appendChild(child.cloneNode(true));
      }
    }
    return clone;
  }

  override toString(markers: boolean): string {
    const tag = this.tagName.toLowerCase();
    let attrs = '';

    if (this.className !== '') {
      attrs += ` class="${escapeAttribute(this.className)}"`;
    }
    if (this.style.cssText) {
      attrs += ` style="${escapeAttribute(this.style.cssText)}"`;
    }
    for (const [key, val] of this.attributes) {
      if (key === 'class' && this.className !== '') continue;
      if (key === 'style' && this.style.cssText) continue;
      if (val === '') {
        attrs += ` ${key}`;
      } else {
        attrs += ` ${key}="${escapeAttribute(val)}"`;
      }
    }

    if (VOID_TAGS.has(tag) && this.firstChild === null) {
      return `<${tag}${attrs}>`;
    }

    let inner = '';
    if (this.innerHTML !== undefined) {
      inner = this.innerHTML;
    } else {
      for (let child = this.firstChild; child !== null; child = child.nextSibling) {
        inner += child.toString(markers);
      }
    }
    return `<${tag}${attrs}>${inner}</${tag}>`;
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

export class StringDocument implements DocumentLike {
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
        node.ns === 'http://www.w3.org/1999/xhtml'
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
    for (const child of parseMarkup(markup)) {
      build(child);
    }
    return output;
  }

  getElementById(): Element | null {
    return null;
  }
}
