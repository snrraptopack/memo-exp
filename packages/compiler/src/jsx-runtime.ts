import type {} from './jsx-types';
import type { DOMIntrinsicElements } from './jsx/dom-types';

/** Type-only JSX source. The compiler consumes JSX; no factory is emitted. */
export namespace JSX {
  export type Element = globalThis.JSX.Element;
  export type Child = globalThis.JSX.Child;
  export type ElementType = globalThis.JSX.ElementType;
  export interface ElementChildrenAttribute {
    children: Child;
  }
  export interface IntrinsicAttributes extends globalThis.JSX.IntrinsicAttributes {}
  export interface IntrinsicElements extends DOMIntrinsicElements {
    [name: `${string}-${string}`]: unknown;
  }
}
