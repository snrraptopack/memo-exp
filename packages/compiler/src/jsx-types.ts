import type { RouteTable } from '@memoized-dom/router';

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
    /** Application route patterns from the generated `.memoized/routes.d.ts`. */
    type RoutePaths = Extract<keyof RouteTable, string>;

    /**
     * A route destination path. Registered application routes appear in
     * autocomplete; any `/`-prefixed string still compiles for dynamic
     * destinations. Collapses to plain `/${string}` when the generated
     * registry is absent.
     */
    type RouteToPath = RoutePaths | `/${string}`;

    /** A `route` pattern declaration site — intentionally not autocompleted. */
    type RouteValue = `/${string}`;

    type RouteParamInput = string | number | boolean | bigint;

    type RouteQueryInput = Record<
      string,
      | RouteParamInput
      | null
      | undefined
      | readonly (RouteParamInput | null | undefined)[]
    >;

    interface RouteToDestinationBase {
      query?: RouteQueryInput;
      hash?: string;
      replace?: boolean;
    }

    interface RouteToDestination extends RouteToDestinationBase {
      path: RouteToPath;
      params?: Record<string, RouteParamInput>;
    }

    /**
     * Object destinations keyed by a registered route: `params` takes that
     * route's exact `input` shape, and is required when the pattern has
     * parameters. The permissive `RouteToDestination` member keeps dynamic
     * paths working, so wrong params are enforced by the compiler rather
     * than by this union.
     */
    type KnownRouteToDestination = {
      [Path in RoutePaths]: RouteToDestinationBase & {
        path: Path;
      } & ([keyof RouteTable[Path]['input']] extends [never]
          ? { params?: RouteTable[Path]['input'] }
          : { params: RouteTable[Path]['input'] });
    }[RoutePaths];

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
      'route-to'?: RouteToPath | KnownRouteToDestination | RouteToDestination;
    }

    interface IntrinsicElements {
      [name: string]: {
        [attribute: string]: unknown;
      };
    }
  }
}
