export type RouteParamValue = string | number | boolean | bigint;

export type RouteQueryValue =
  | RouteParamValue
  | null
  | undefined
  | readonly (RouteParamValue | null | undefined)[];

export type RouteQueryInput = Readonly<Record<string, RouteQueryValue>>;

export type ParsedRouteQuery = Readonly<
  Record<string, string | readonly string[]>
>;

type SegmentParam<Segment extends string> =
  Segment extends `:${infer Name}`
    ? Name extends '' ? never : Name
    : Segment extends '*'
      ? '*'
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
  readonly metadata?: unknown;
}

export interface RoutePatternDefinition {
  readonly id: string;
  readonly pattern: string;
  readonly parentId?: string;
  readonly metadata?: unknown;
}

export type NavigationType = 'load' | 'push' | 'replace' | 'pop';

/** The read-only portion of URLSearchParams exposed by route state. */
export interface RouteQuery extends Iterable<[string, string]> {
  readonly size: number;
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string, value?: string): boolean;
  entries(): URLSearchParamsIterator<[string, string]>;
  keys(): URLSearchParamsIterator<string>;
  values(): URLSearchParamsIterator<string>;
  forEach(
    callback: (value: string, key: string, query: RouteQuery) => void,
    thisArg?: unknown,
  ): void;
  toString(): string;
}

export interface RouteLocationSnapshot {
  readonly href: string;
  readonly pathname: string;
  readonly search: string;
  readonly query: RouteQuery;
  readonly hash: string;
  readonly state: unknown;
  readonly navigationType: NavigationType;
  readonly signal: AbortSignal;
}

export interface RouteSnapshot {
  readonly href: string;
  readonly pathname: string;
  readonly search: string;
  readonly query: RouteQuery;
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
  readonly query: RouteQuery;
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

export interface RelativeNavigateOptions<Path extends string = string>
  extends NavigateOptions<Path> {
  /** Path used as the relative base. Defaults to the active pathname. */
  readonly from?: string;
}

export type NavigateArguments<Path extends string> =
  string extends Path
    ? [options?: NavigateOptions<Path>]
    : keyof RouteParams<Path> extends never
      ? [options?: NavigateOptions<Path>]
      : [options: NavigateOptions<Path> & { readonly params: RouteParams<Path> }];

export type RelativeNavigateArguments<Path extends string> =
  string extends Path
    ? [options?: RelativeNavigateOptions<Path>]
    : keyof RouteParams<Path> extends never
      ? [options?: RelativeNavigateOptions<Path>]
      : [options: RelativeNavigateOptions<Path> & { readonly params: RouteParams<Path> }];

export type RouteListener = (snapshot: RouteSnapshot) => void;

export type RouteSelector<Value> = (route: RouteState) => Value;

export type RouteSelectionListener<Value> = (
  value: Value,
  route: RouteState,
) => void;

export type RouteSelectionEquality<Value> = (
  previous: Value,
  next: Value,
) => boolean;

export interface RouteNavigationLocation {
  readonly href: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly state: unknown;
}

export interface RouteNavigation {
  readonly id: number;
  readonly from: RouteNavigationLocation;
  readonly to: RouteNavigationLocation;
  readonly type: Exclude<NavigationType, 'load'>;
}

export interface RouteRedirect {
  readonly to: string | URL;
  readonly replace?: boolean;
  readonly state?: unknown;
}

export type RouteNavigationDecision = boolean | void | RouteRedirect;

/** A synchronous navigation guard. Async work belongs to the data boundary. */
export type RouteNavigationBlocker = (
  navigation: RouteNavigation,
) => RouteNavigationDecision;

export type RouteNavigationPhase =
  | 'start'
  | 'redirect'
  | 'blocked'
  | 'complete';

export interface RouteNavigationEvent {
  readonly phase: RouteNavigationPhase;
  readonly navigation: RouteNavigation;
  readonly redirect?: RouteRedirect;
}

export type RouteNavigationListener = (event: RouteNavigationEvent) => void;

export type RouteNavigationResult =
  | {
      readonly status: 'completed';
      readonly navigation: RouteNavigation;
      readonly redirects: number;
    }
  | {
      readonly status: 'blocked';
      readonly navigation: RouteNavigation;
      readonly redirects: number;
    };

export function redirectRoute(
  to: string | URL,
  options: Omit<RouteRedirect, 'to'> = {},
): RouteRedirect {
  return Object.freeze({ to, ...options });
}

export type RouteResolver = (
  location: RouteLocationSnapshot,
) => readonly RouteMatch[];

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

export interface RouteTableMatcher {
  match(pathname: string): RouteMatch | null;
  resolve(location: RouteLocationSnapshot): readonly RouteMatch[];
}

export interface RouteManifestEntry extends RoutePatternDefinition {
  readonly fullPattern: string;
  readonly depth: number;
}

export interface RouteManifest extends RouteTableMatcher {
  readonly entries: readonly RouteManifestEntry[];
  get(id: string): RouteManifestEntry | undefined;
  matchAll(pathname: string): readonly RouteMatch[];
  build(
    id: string,
    options?: NavigateOptions<string>,
  ): string;
}
