/**
 * Register synchronous teardown owned by the current compiled component.
 * The compiler supplies the component identity in generated output.
 */
declare function cleanup(disposer: () => void): () => void;

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
