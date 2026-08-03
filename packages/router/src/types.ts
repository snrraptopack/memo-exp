export type RouteParamValue = string | number | boolean | bigint;

export type RouteQueryValue =
  | RouteParamValue
  | null
  | undefined
  | readonly (RouteParamValue | null | undefined)[];

export type RouteQueryInput = Readonly<Record<string, RouteQueryValue>>;

type SegmentParam<Segment extends string> =
  Segment extends `:${infer Name}`
    ? Name extends '' ? never : Name
    : never;

type PathParamNames<Path extends string> =
  Path extends `${infer Head}/${infer Tail}`
    ? SegmentParam<Head> | PathParamNames<Tail>
    : SegmentParam<Path>;

export type RouteParams<Path extends string> =
  string extends Path
    ? Record<string, RouteParamValue>
    : [PathParamNames<Path>] extends [never]
      ? Record<never, never>
      : { [Name in PathParamNames<Path>]: RouteParamValue };

export interface RouteMatch {
  readonly id: string;
  readonly pattern: string;
  readonly pathname: string;
  readonly params: Readonly<Record<string, string>>;
}

export type NavigationType = 'load' | 'push' | 'replace' | 'pop';

export interface RouteSnapshot {
  readonly href: string;
  readonly pathname: string;
  readonly search: string;
  readonly query: URLSearchParams;
  readonly hash: string;
  readonly state: unknown;
  readonly navigationType: NavigationType;
  readonly params: Readonly<Record<string, string>>;
  readonly matches: readonly RouteMatch[];
  readonly matched: RouteMatch | null;
  readonly signal: AbortSignal;
}

export interface RouteState {
  readonly href: string;
  readonly pathname: string;
  readonly search: string;
  readonly query: URLSearchParams;
  readonly hash: string;
  readonly state: unknown;
  readonly navigationType: NavigationType;
  readonly params: Readonly<Record<string, string>>;
  readonly matches: readonly RouteMatch[];
  readonly matched: RouteMatch | null;
  readonly signal: AbortSignal;
}

export interface NavigateOptions<Path extends string = string> {
  readonly params?: RouteParams<Path>;
  readonly query?: RouteQueryInput;
  readonly hash?: string;
  readonly state?: unknown;
  readonly replace?: boolean;
}

export type NavigateArguments<Path extends string> =
  string extends Path
    ? [options?: NavigateOptions<Path>]
    : keyof RouteParams<Path> extends never
      ? [options?: NavigateOptions<Path>]
      : [options: NavigateOptions<Path> & { readonly params: RouteParams<Path> }];

export type RouteListener = (snapshot: RouteSnapshot) => void;

export interface PatternMatch {
  readonly pattern: string;
  readonly pathname: string;
  readonly params: Readonly<Record<string, string>>;
  readonly consumed: string;
  readonly remaining: string;
}

export interface MatchPatternOptions {
  readonly end?: boolean;
}
