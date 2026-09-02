export {};

declare global {
  /**
   * Register synchronous teardown owned by the current compiled component.
   * The compiler supplies the component identity in generated output.
   */
  function cleanup(disposer: () => void): () => void;

  /**
   * Run a compiler-tracked side effect after DOM updates. At component scope,
   * teardown follows the owner; at module scope the effect is a singleton.
   */
  function effect(callback: () => void | (() => void)): void;

  /** Minimal global JSX declarations for compiler-authored source. */
  namespace JSX {
    type RouteValue = `/${string}`;

    interface RouteToDestination {
      path: RouteValue;
      params?: Record<string, string | number | boolean | bigint>;
      query?: Record<
        string,
        | string
        | number
        | boolean
        | bigint
        | null
        | undefined
        | readonly (string | number | boolean | bigint | null | undefined)[]
      >;
      hash?: string;
      replace?: boolean;
    }

    interface ElementChildrenAttribute {
      children: unknown;
    }

    interface IntrinsicAttributes {
      key?: unknown;
      if?: boolean;
      'else-if'?: boolean;
      else?: true;
      suspend?: true;
      route?: RouteValue;
      'route-to'?: RouteValue | RouteToDestination;
    }

    interface IntrinsicElements {
      [name: string]: {
        [attribute: string]: unknown;
      };
    }
  }
}
