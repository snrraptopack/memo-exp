/**
 * Register synchronous teardown owned by the current compiled component.
 * The compiler supplies the component identity in generated output.
 */
declare function cleanup(disposer: () => void): () => void;

declare namespace JSX {
  interface IntrinsicAttributes {
    key?: unknown;
  }

  interface IntrinsicElements {
    [name: string]: any;
  }
}
