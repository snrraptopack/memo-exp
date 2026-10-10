/** JSX contracts derived from the platform DOM maps, shared by every renderer. */
type Scalar = string | number | boolean | null | undefined;
export type ClassValue = Scalar | Readonly<Record<string, Scalar>> | readonly ClassValue[];
type AttributeValue<T> = T extends number
  ? number | string | null
  : T extends string
    ? T | number | null
    : T | null;
// Reflected scalar properties provide tag-specific attributes. Methods and
// object-valued DOM internals are excluded; content-attribute exceptions follow.
type Properties<T> = {
  [
    P in keyof T as P extends string ? (T[P] extends Scalar ? P | Lowercase<P> : never) : never
  ]?: AttributeValue<T[P]>;
};

export type CSSProperties = {
  [
    P in keyof CSSStyleDeclaration as P extends string
      ? CSSStyleDeclaration[P] extends string
        ? P | Hyphenated<P>
        : never
      : never
  ]?: string | number | null;
} & { [property: `--${string}`]: string | number | null | undefined };

// DOM event names are lowercase; JSX uses word boundaries such as onKeyDown.
// Families share one rule. Compound names below need an explicit spelling.
type EventFamily =
  'mouse' | 'pointer' | 'key' | 'touch' | 'drag' | 'animation' | 'transition' | 'composition';

type FamilyEventName<K extends string> = {
  [Prefix in EventFamily]: K extends `${Prefix}${infer Rest}`
    ? `${Capitalize<Prefix>}${Capitalize<Rest>}`
    : never;
}[EventFamily];

interface CompoundEventNames {
  dblclick: 'DblClick';
  focusin: 'FocusIn';
  focusout: 'FocusOut';
  beforeinput: 'BeforeInput';
  beforetoggle: 'BeforeToggle';
  contextmenu: 'ContextMenu';
  gotpointercapture: 'GotPointerCapture';
  lostpointercapture: 'LostPointerCapture';
  canplaythrough: 'CanPlayThrough';
  canplay: 'CanPlay';
  durationchange: 'DurationChange';
  loadeddata: 'LoadedData';
  loadedmetadata: 'LoadedMetadata';
  loadstart: 'LoadStart';
  ratechange: 'RateChange';
  timeupdate: 'TimeUpdate';
  volumechange: 'VolumeChange';
  selectionchange: 'SelectionChange';
  selectstart: 'SelectStart';
  scrollend: 'ScrollEnd';
  securitypolicyviolation: 'SecurityPolicyViolation';
  fullscreenchange: 'FullscreenChange';
  fullscreenerror: 'FullscreenError';
}

type EventName<K extends string> = K extends keyof CompoundEventNames
  ? CompoundEventNames[K]
  : [FamilyEventName<K>] extends [never]
    ? Capitalize<K>
    : FamilyEventName<K>;

// Preserve the platform event type while narrowing currentTarget to its tag.
type Handler<E extends Event, T extends Element> = {
  callback(event: E & { readonly currentTarget: T }): void;
}['callback'];

type Events<T extends Element> = {
  [
    K in keyof HTMLElementEventMap as
      `on${EventName<K>}` | `on${Capitalize<K>}` | (K extends 'dblclick' ? 'onDoubleClick' : never)
  ]?: Handler<HTMLElementEventMap[K], T>;
};

export type ElementRef<T extends Element = Element> =
  | Element
  | null
  | undefined
  | false
  | ((element: T) => void | (() => void))
  | readonly ElementRef<T>[];
type Common<T extends Element> = JSX.IntrinsicAttributes &
  Events<T> & {
    children?: JSX.Child;
    // Both spellings use the framework's string/map/array class contract.
    class?: ClassValue;
    className?: ClassValue;
    style?: string | CSSProperties;
    ref?: ElementRef<T>;
    role?: string;
    [attribute: `data-${string}`]: Scalar;
    [attribute: `aria-${string}`]: Scalar;
  };

export type HTMLAttributes<T extends HTMLElement> = Common<T> &
  Properties<Omit<T, 'style' | 'className' | 'download' | 'contentEditable'>> & {
    for?: string;
    // Content attributes differ from a few reflected DOM property types.
    download?: string | boolean;
    contentEditable?: boolean | 'true' | 'false' | 'inherit' | 'plaintext-only';
    contenteditable?: boolean | 'true' | 'false' | 'inherit' | 'plaintext-only';
    'http-equiv'?: T extends HTMLMetaElement ? string : never;
    'accept-charset'?: T extends HTMLFormElement ? string : never;
    popovertarget?: T extends HTMLButtonElement | HTMLInputElement ? string : never;
  };

type Hyphenated<P extends string> = P extends `${infer First}${infer Rest}`
  ? `${First extends Lowercase<First> ? First : `-${Lowercase<First>}`}${Hyphenated<Rest>}`
  : P;
type SVGPresentationAttributes = {
  [P in keyof CSSProperties as P extends string ? P | Hyphenated<P> : never]?: CSSProperties[P];
};

// SVG reflects several attributes as animated wrappers; JSX supplies their
// scalar content values instead of constructing those platform objects.
type SVGAnimatedValue =
  | SVGAnimatedLength
  | SVGAnimatedNumber
  | SVGAnimatedInteger
  | SVGAnimatedString
  | SVGAnimatedEnumeration
  | SVGAnimatedBoolean
  | SVGAnimatedRect
  | SVGAnimatedPreserveAspectRatio
  | SVGAnimatedLengthList
  | SVGAnimatedNumberList
  | SVGAnimatedTransformList;

export type SVGAttributes<T extends SVGElement> = Common<T> &
  SVGPresentationAttributes &
  Properties<Omit<T, 'style' | 'className'>> & {
    [P in keyof T as T[P] extends SVGAnimatedValue ? P : never]?: string | number;
  } & {
    fill?: string;
    stroke?: string;
    strokeWidth?: string | number;
    'stroke-width'?: string | number;
    strokeLinecap?: 'butt' | 'round' | 'square';
    strokeLinejoin?: 'miter' | 'round' | 'bevel';
    strokeDasharray?: string | number;
    fillRule?: 'nonzero' | 'evenodd';
    clipRule?: 'nonzero' | 'evenodd';
    opacity?: string | number;
    xmlns?: string;
    'xmlns:xlink'?: string;
    'xlink:href'?: string;
    d?: string;
    points?: string;
    transform?: string;
    fillOpacity?: string | number;
    strokeOpacity?: string | number;
    'fill-opacity'?: string | number;
    'stroke-opacity'?: string | number;
  };

export type DOMIntrinsicElements = {
  [K in keyof HTMLElementTagNameMap]: HTMLAttributes<HTMLElementTagNameMap[K]>;
} & {
  [
    K in Exclude<keyof HTMLElementDeprecatedTagNameMap, keyof HTMLElementTagNameMap>
  ]: HTMLAttributes<HTMLElementDeprecatedTagNameMap[K]>;
} & {
  [K in Exclude<keyof SVGElementTagNameMap, keyof HTMLElementTagNameMap>]: SVGAttributes<
    SVGElementTagNameMap[K]
  >;
} & {
  [K in keyof MathMLElementTagNameMap]: Common<MathMLElementTagNameMap[K]> &
    Properties<Omit<MathMLElementTagNameMap[K], 'style' | 'className'>>;
};
