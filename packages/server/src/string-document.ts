/**
 * string-document.ts — Phase 4 Direct String-Writer Document Tier.
 *
 * Provides a lightweight DocumentLike implementation designed for ultra-fast
 * server rendering without allocating heavyweight DOM element trees.
 */

import type { DocumentLike } from '@memoized-dom/runtime';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
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
  nextSibling: StringRenderableNode | null;
  textContent: string | null;
  outerHTML?: string;
  appendChild(child: StringRenderableNode): StringRenderableNode;
  insertBefore(newNode: StringRenderableNode, referenceNode: StringRenderableNode | null): StringRenderableNode;
  removeChild(child: StringRenderableNode): StringRenderableNode;
  cloneNode(deep?: boolean): StringRenderableNode;
  toString(markers: boolean): string;
}

export class StringComment implements StringRenderableNode {
  readonly nodeType = 8;
  parentNode: StringRenderableNode | null = null;
  firstChild: StringRenderableNode | null = null;
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
    if (!markers) return '';
    return `<!--${this.data}-->`;
  }
}

export class StringText implements StringRenderableNode {
  readonly nodeType = 3;
  parentNode: StringRenderableNode | null = null;
  firstChild: StringRenderableNode | null = null;
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

export class StringElement implements StringRenderableNode {
  readonly nodeType = 1;
  parentNode: StringRenderableNode | null = null;
  firstChild: StringRenderableNode | null = null;
  nextSibling: StringRenderableNode | null = null;

  readonly attributes = new Map<string, string>();
  readonly childNodes: StringRenderableNode[] = [];
  className = '';
  style: Record<string, string> & { cssText?: string } = {};
  innerHTML?: string;

  constructor(public readonly tagName: string, public readonly namespaceURI: string = 'http://www.w3.org/1999/xhtml') {}

  get textContent(): string {
    return this.childNodes.map((c) => c.textContent ?? '').join('');
  }

  set textContent(text: string) {
    this.childNodes.length = 0;
    if (text !== '') {
      this.appendChild(new StringText(text));
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name.toLowerCase(), String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name.toLowerCase());
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name.toLowerCase());
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  appendChild(child: StringRenderableNode): StringRenderableNode {
    if (child.nodeType === 11 /* FRAGMENT */) {
      const fragment = child as StringFragment;
      for (const fc of [...fragment.childNodes]) {
        this.appendChild(fc);
      }
      fragment.childNodes.length = 0;
      return child;
    }
    child.parentNode = this;
    if (this.childNodes.length > 0) {
      this.childNodes.at(-1)!.nextSibling = child;
    } else {
      this.firstChild = child;
    }
    this.childNodes.push(child);
    return child;
  }

  insertBefore(newNode: StringRenderableNode, refNode: StringRenderableNode | null): StringRenderableNode {
    if (refNode === null) return this.appendChild(newNode);
    if (newNode.nodeType === 11 /* FRAGMENT */) {
      const fragment = newNode as StringFragment;
      for (const fc of [...fragment.childNodes]) {
        this.insertBefore(fc, refNode);
      }
      fragment.childNodes.length = 0;
      return newNode;
    }
    const idx = this.childNodes.indexOf(refNode);
    if (idx < 0) return this.appendChild(newNode);
    newNode.parentNode = this;
    this.childNodes.splice(idx, 0, newNode);
    this.relinkSiblings();
    return newNode;
  }

  removeChild(child: StringRenderableNode): StringRenderableNode {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
      this.relinkSiblings();
    }
    return child;
  }

  cloneNode(deep = false): StringRenderableNode {
    const clone = new StringElement(this.tagName, this.namespaceURI);
    clone.className = this.className;
    clone.style = { ...this.style };
    clone.innerHTML = this.innerHTML;
    for (const [k, v] of this.attributes) {
      clone.attributes.set(k, v);
    }
    if (deep) {
      for (const child of this.childNodes) {
        clone.appendChild(child.cloneNode(true));
      }
    }
    return clone;
  }

  private relinkSiblings(): void {
    this.firstChild = this.childNodes[0] ?? null;
    for (let i = 0; i < this.childNodes.length; i++) {
      this.childNodes[i]!.nextSibling = this.childNodes[i + 1] ?? null;
    }
  }

  toString(markers: boolean): string {
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

    if (VOID_TAGS.has(tag) && this.childNodes.length === 0) {
      return `<${tag}${attrs}>`;
    }

    let inner = '';
    if (this.innerHTML !== undefined) {
      inner = this.innerHTML;
    } else {
      for (let i = 0; i < this.childNodes.length; i++) {
        inner += this.childNodes[i]!.toString(markers);
      }
    }
    return `<${tag}${attrs}>${inner}</${tag}>`;
  }
}

export class StringFragment implements StringRenderableNode {
  readonly nodeType = 11;
  parentNode: StringRenderableNode | null = null;
  firstChild: StringRenderableNode | null = null;
  nextSibling: StringRenderableNode | null = null;
  textContent: string | null = null;
  readonly childNodes: StringRenderableNode[] = [];

  appendChild(child: StringRenderableNode): StringRenderableNode {
    child.parentNode = this;
    if (this.childNodes.length > 0) {
      this.childNodes.at(-1)!.nextSibling = child;
    } else {
      this.firstChild = child;
    }
    this.childNodes.push(child);
    return child;
  }

  insertBefore(newNode: StringRenderableNode, refNode: StringRenderableNode | null): StringRenderableNode {
    if (refNode === null) return this.appendChild(newNode);
    const idx = this.childNodes.indexOf(refNode);
    if (idx < 0) return this.appendChild(newNode);
    newNode.parentNode = this;
    this.childNodes.splice(idx, 0, newNode);
    this.firstChild = this.childNodes[0] ?? null;
    return newNode;
  }

  removeChild(child: StringRenderableNode): StringRenderableNode {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
      this.firstChild = this.childNodes[0] ?? null;
    }
    return child;
  }

  cloneNode(deep = false): StringRenderableNode {
    const clone = new StringFragment();
    if (deep) {
      for (const child of this.childNodes) {
        clone.appendChild(child.cloneNode(true));
      }
    }
    return clone;
  }

  toString(markers: boolean): string {
    let out = '';
    for (const c of this.childNodes) out += c.toString(markers);
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

  getElementById(): Element | null {
    return null;
  }
}
