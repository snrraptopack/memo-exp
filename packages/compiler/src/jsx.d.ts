/**
 * Register synchronous teardown owned by the current compiled component.
 * The compiler supplies the component identity in generated output.
 */
declare function cleanup(disposer: () => void): () => void;

/**
 * Run a compiler-tracked side effect after DOM updates. A returned teardown
 * runs before the next execution and when the owning component unmounts.
 */
declare function effect(callback: () => void | (() => void)): void;

/** Minimal JSX declarations for compiler package source fixtures. */
declare namespace JSX {
  interface ElementChildrenAttribute {
    children: unknown;
  }

  interface IntrinsicAttributes {
    key?: unknown;
  }

  interface IntrinsicElements {
    [name: string]: any;
  }
}
