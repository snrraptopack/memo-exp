/**
 * The CSS value vocabulary as TypeScript types.
 *
 * Property values, param signatures, and media features are all built from
 * these grammars. They are deliberately pragmatic — common forms are typed
 * precisely, exotic forms go through the `${fn}(${string})` catch-alls. This
 * is a vocabulary, not a spec conformance suite.
 */

export type Length =
  | `${number}px`
  | `${number}em`
  | `${number}rem`
  | `${number}vw`
  | `${number}vh`
  | `${number}svw`
  | `${number}svh`
  | `${number}lvw`
  | `${number}lvh`
  | `${number}dvw`
  | `${number}dvh`
  | `${number}ch`
  | `${number}ex`
  | `${number}lh`
  | `${number}cm`
  | `${number}mm`
  | `${number}in`
  | `${number}pt`
  | `${number}pc`
  | `${number}q`
  | `calc(${string})`
  | `min(${string})`
  | `max(${string})`
  | `clamp(${string})`
  | `var(--${string})`;

export type Percentage = `${number}%`;

export type Angle =
  | `${number}deg`
  | `${number}rad`
  | `${number}grad`
  | `${number}turn`;

export type Time = `${number}s` | `${number}ms`;

export type NamedColor =
  | 'black' | 'white' | 'red' | 'green' | 'blue' | 'yellow' | 'orange'
  | 'purple' | 'pink' | 'brown' | 'gray' | 'grey' | 'cyan' | 'magenta'
  | 'lime' | 'navy' | 'teal' | 'olive' | 'maroon' | 'aqua' | 'silver'
  | 'tomato' | 'royalblue' | 'rebeccapurple' | 'transparent' | 'currentcolor';

export type Color =
  | NamedColor
  | `#${string}`
  | `rgb(${string})`
  | `rgba(${string})`
  | `hsl(${string})`
  | `hsla(${string})`
  | `hwb(${string})`
  | `lab(${string})`
  | `lch(${string})`
  | `oklab(${string})`
  | `oklch(${string})`
  | `color(${string})`
  | `color-mix(${string})`
  | `light-dark(${string})`
  | `var(--${string})`;

/** A custom-property reference produced by `vars()`. */
export interface VarRef<V = unknown> {
  readonly $$md: 'var';
  readonly varName: `--${string}`;
  readonly value?: V;
  toString(): string;
}

/** Viewport-width range keys for value maps — the operand is a Length. */
export type RangeKey =
  | `>=${Length}`
  | `<${Length}`
  | `${Length}..${Length}`;

/**
 * A responsive value map — `{ base, '>=40rem', '20rem..40rem' }`.
 * `base` is the default; range keys override it at their breakpoint.
 */
export type ValueMap<V> = { base?: V } & Partial<Record<RangeKey, V>>;

/** Anything a property position can hold. */
export type Value<V> = V | number | VarRef | ValueMap<V | number>;

/** A custom property declaration key. */
export type CustomPropertyKey = `--${string}`;

/** Pseudo-classes/elements as bare keys (camelCase → kebab at emit). */
export type PseudoKey =
  // pseudo-classes
  | 'hover' | 'active' | 'focus' | 'focusVisible' | 'focusWithin'
  | 'visited' | 'link' | 'target' | 'disabled' | 'enabled' | 'checked'
  | 'indeterminate' | 'required' | 'optional' | 'readOnly' | 'readWrite'
  | 'empty' | 'root' | 'firstChild' | 'lastChild' | 'onlyChild'
  | 'firstOfType' | 'lastOfType' | 'onlyOfType' | 'placeholderShown'
  | 'autofill' | 'anyLink' | 'fullscreen' | 'modal' | 'popoverOpen'
  | 'userInvalid' | 'userValid' | 'inert' | 'paused' | 'playing'
  // pseudo-elements
  | 'before' | 'after' | 'placeholder' | 'marker' | 'selection'
  | 'backdrop' | 'firstLine' | 'firstLetter' | 'fileSelectorButton'
  | 'grammarError' | 'spellingError' | 'targetText' | 'highlight'
  // parameterized pseudos (kebab form, arg validated loosely)
  | `nth-child(${string})` | `nth-last-child(${string})`
  | `nth-of-type(${string})` | `nth-last-of-type(${string})`
  | `not(${string})` | `is(${string})` | `where(${string})`
  | `has(${string})` | `dir(${string})` | `lang(${string})`
  | `host(${string})` | `state(${string})`;

/** Selector keys must start with a combinator or selector character. */
export type SelectorKey =
  | `.${string}` | `#${string}` | `&${string}` | `>${string}`
  | `+${string}` | `~${string}` | `*${string}` | `[${string}]`;

export interface MediaFeatures {
  minWidth?: Length;
  maxWidth?: Length;
  minHeight?: Length;
  maxHeight?: Length;
  orientation?: 'portrait' | 'landscape';
  aspectRatio?: `${number}/${number}` | number;
  prefersColorScheme?: 'light' | 'dark';
  prefersReducedMotion?: 'reduce' | 'no-preference';
  prefersContrast?: 'more' | 'less' | 'no-preference';
  hover?: 'hover' | 'none';
  pointer?: 'fine' | 'coarse' | 'none';
  displayMode?: 'fullscreen' | 'standalone' | 'browser';
  forcedColors?: 'active' | 'none';
  invertedColors?: 'inverted' | 'none';
  monochrome?: number;
  resolution?: `${number}dpi` | `${number}dppx` | `${number}x`;
  style?: StyleObject;
}

export interface SupportsBlock {
  query: Partial<Record<string, string | number>>;
  style?: StyleObject;
}

export interface ContainerBlock {
  minWidth?: Length;
  maxWidth?: Length;
  minHeight?: Length;
  maxHeight?: Length;
  orientation?: 'portrait' | 'landscape';
  name?: string;
  style?: StyleObject;
}

export interface LayerBlock {
  name?: string;
  style?: StyleObject;
}

/** Reserved at-rule keys. */
export interface AtRuleKeys {
  media?: MediaFeatures;
  supports?: SupportsBlock;
  container?: ContainerBlock;
  layer?: LayerBlock;
}

/**
 * The style object grammar: known properties get typed values, contexts get
 * nested StyleObjects, everything else falls through to the index signature
 * (new CSS properties land faster than types do — the classifier validates
 * at runtime what the types can't).
 */
export type StyleObject =
  & StyleProperties
  & AtRuleKeys
  & { [K in PseudoKey]?: StyleObject }
  & { [K in SelectorKey]?: StyleObject }
  & { [key: string]: StyleEntry };

export type StyleEntry = Value<unknown> | StyleObject | undefined;

/**
 * Typed CSS properties. Values accept the grammar type, a plain number, a
 * VarRef, or a responsive ValueMap. This list covers the common surface;
 * unlisted properties go through the index signature.
 */
export interface StyleProperties {
  display?: Value<
    | 'block' | 'inline' | 'inline-block' | 'flex' | 'inline-flex' | 'grid'
    | 'inline-grid' | 'none' | 'contents' | 'flow-root' | 'table'
    | `list-item` | (string & {})
  >;
  position?: Value<'static' | 'relative' | 'absolute' | 'fixed' | 'sticky'>;
  inset?: Value<Length | Percentage | 'auto'>;
  top?: Value<Length | Percentage | 'auto'>;
  right?: Value<Length | Percentage | 'auto'>;
  bottom?: Value<Length | Percentage | 'auto'>;
  left?: Value<Length | Percentage | 'auto'>;
  zIndex?: Value<number | 'auto'>;
  width?: Value<Length | Percentage | 'auto' | 'fit-content' | `min-content` | `max-content`>;
  height?: Value<Length | Percentage | 'auto' | 'fit-content' | `min-content` | `max-content`>;
  minWidth?: Value<Length | Percentage>;
  maxWidth?: Value<Length | Percentage | 'none'>;
  minHeight?: Value<Length | Percentage>;
  maxHeight?: Value<Length | Percentage | 'none'>;
  margin?: Value<Length | Percentage | 'auto' | `${string} ${string}`>;
  marginTop?: Value<Length | Percentage | 'auto'>;
  marginRight?: Value<Length | Percentage | 'auto'>;
  marginBottom?: Value<Length | Percentage | 'auto'>;
  marginLeft?: Value<Length | Percentage | 'auto'>;
  padding?: Value<Length | Percentage | `${string} ${string}`>;
  paddingTop?: Value<Length | Percentage>;
  paddingRight?: Value<Length | Percentage>;
  paddingBottom?: Value<Length | Percentage>;
  paddingLeft?: Value<Length | Percentage>;
  boxSizing?: Value<'border-box' | 'content-box'>;
  overflow?: Value<'visible' | 'hidden' | 'clip' | 'scroll' | 'auto'>;
  overflowX?: Value<'visible' | 'hidden' | 'clip' | 'scroll' | 'auto'>;
  overflowY?: Value<'visible' | 'hidden' | 'clip' | 'scroll' | 'auto'>;
  flex?: Value<`${number}` | `${number} ${number}` | 'none' | 'auto' | 'initial'>;
  flexGrow?: Value<number>;
  flexShrink?: Value<number>;
  flexBasis?: Value<Length | Percentage | 'auto' | 'content'>;
  flexDirection?: Value<'row' | 'row-reverse' | 'column' | 'column-reverse'>;
  flexWrap?: Value<'nowrap' | 'wrap' | 'wrap-reverse'>;
  flexFlow?: Value<string>;
  gap?: Value<Length | Percentage>;
  rowGap?: Value<Length | Percentage>;
  columnGap?: Value<Length | Percentage>;
  alignItems?: Value<'stretch' | 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'start' | 'end'>;
  alignContent?: Value<'stretch' | 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly'>;
  alignSelf?: Value<'auto' | 'stretch' | 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'start' | 'end'>;
  justifyContent?: Value<'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly' | 'start' | 'end'>;
  justifyItems?: Value<'stretch' | 'start' | 'end' | 'center' | 'baseline'>;
  justifySelf?: Value<'auto' | 'stretch' | 'start' | 'end' | 'center' | 'baseline'>;
  placeItems?: Value<string>;
  placeContent?: Value<string>;
  order?: Value<number>;
  gridTemplateColumns?: Value<string>;
  gridTemplateRows?: Value<string>;
  gridTemplateAreas?: Value<string>;
  gridAutoColumns?: Value<string>;
  gridAutoRows?: Value<string>;
  gridAutoFlow?: Value<'row' | 'column' | 'dense' | `${'row' | 'column'} dense`>;
  gridColumn?: Value<string>;
  gridRow?: Value<string>;
  gridArea?: Value<string>;
  color?: Value<Color>;
  background?: Value<Color | `url(${string})` | `linear-gradient(${string})` | `radial-gradient(${string})` | `conic-gradient(${string})` | (string & {})>;
  backgroundColor?: Value<Color>;
  backgroundImage?: Value<`url(${string})` | `linear-gradient(${string})` | `radial-gradient(${string})` | `conic-gradient(${string})` | `repeating-${string}` | 'none'>;
  backgroundSize?: Value<'cover' | 'contain' | 'auto' | Length | Percentage | `${string} ${string}`>;
  backgroundPosition?: Value<string>;
  backgroundRepeat?: Value<'repeat' | 'no-repeat' | 'repeat-x' | 'repeat-y' | 'space' | 'round'>;
  backgroundClip?: Value<'border-box' | 'padding-box' | 'content-box' | 'text'>;
  border?: Value<string>;
  borderTop?: Value<string>;
  borderRight?: Value<string>;
  borderBottom?: Value<string>;
  borderLeft?: Value<string>;
  borderWidth?: Value<Length | 'thin' | 'medium' | 'thick'>;
  borderStyle?: Value<'none' | 'solid' | 'dashed' | 'dotted' | 'double' | 'groove' | 'ridge' | 'inset' | 'outset' | 'hidden'>;
  borderColor?: Value<Color>;
  borderRadius?: Value<Length | Percentage | `${string} ${string}`>;
  borderTopLeftRadius?: Value<Length | Percentage>;
  borderTopRightRadius?: Value<Length | Percentage>;
  borderBottomLeftRadius?: Value<Length | Percentage>;
  borderBottomRightRadius?: Value<Length | Percentage>;
  outline?: Value<string>;
  outlineWidth?: Value<Length | 'thin' | 'medium' | 'thick'>;
  outlineStyle?: Value<'none' | 'solid' | 'dashed' | 'dotted' | 'double' | 'auto'>;
  outlineColor?: Value<Color | 'invert'>;
  outlineOffset?: Value<Length>;
  boxShadow?: Value<string | 'none'>;
  opacity?: Value<number | Percentage>;
  visibility?: Value<'visible' | 'hidden' | 'collapse'>;
  cursor?: Value<'auto' | 'default' | 'pointer' | 'text' | 'move' | 'not-allowed' | 'grab' | 'grabbing' | 'wait' | 'help' | 'crosshair' | 'zoom-in' | 'zoom-out' | `url(${string})`>;
  pointerEvents?: Value<'auto' | 'none' | 'visiblePainted' | 'visibleFill' | 'visibleStroke' | 'visible' | 'painted' | 'fill' | 'stroke' | 'all'>;
  userSelect?: Value<'auto' | 'none' | 'text' | 'all' | 'contain'>;
  fontFamily?: Value<string>;
  fontSize?: Value<Length | Percentage | 'larger' | 'smaller' | 'xx-small' | 'x-small' | 'small' | 'medium' | 'large' | 'x-large' | 'xx-large'>;
  fontWeight?: Value<number | 'normal' | 'bold' | 'bolder' | 'lighter'>;
  fontStyle?: Value<'normal' | 'italic' | 'oblique' | `oblique ${Angle}`>;
  fontVariant?: Value<string>;
  fontStretch?: Value<Percentage | 'normal' | 'condensed' | 'expanded' | `${string}-condensed` | `${string}-expanded`>;
  lineHeight?: Value<number | Length | Percentage | 'normal'>;
  letterSpacing?: Value<Length | 'normal'>;
  wordSpacing?: Value<Length | 'normal'>;
  textAlign?: Value<'start' | 'end' | 'left' | 'right' | 'center' | 'justify' | 'match-parent'>;
  textDecoration?: Value<string>;
  textDecorationLine?: Value<'none' | 'underline' | 'overline' | 'line-through' | `${string} ${string}`>;
  textDecorationColor?: Value<Color>;
  textDecorationStyle?: Value<'solid' | 'double' | 'dotted' | 'dashed' | 'wavy'>;
  textTransform?: Value<'none' | 'capitalize' | 'uppercase' | 'lowercase' | 'full-width'>;
  textOverflow?: Value<'clip' | 'ellipsis'>;
  textWrap?: Value<'wrap' | 'nowrap' | 'balance' | 'pretty'>;
  whiteSpace?: Value<'normal' | 'nowrap' | 'pre' | 'pre-wrap' | 'pre-line' | 'break-spaces'>;
  wordBreak?: Value<'normal' | 'break-all' | 'keep-all' | 'break-word'>;
  verticalAlign?: Value<'baseline' | 'sub' | 'super' | 'top' | 'text-top' | 'middle' | 'bottom' | 'text-bottom' | Length | Percentage>;
  listStyle?: Value<string>;
  listStyleType?: Value<'none' | 'disc' | 'circle' | 'square' | 'decimal' | `${string}-` | (string & {})>;
  transform?: Value<`translate(${string})` | `translate${'X' | 'Y' | 'Z'}(${string})` | `translate3d(${string})` | `scale(${string})` | `scale${'X' | 'Y' | 'Z' | '3d'}(${string})` | `rotate(${string})` | `rotate${'X' | 'Y' | 'Z' | '3d'}(${string})` | `skew(${string})` | `matrix(${string})` | `${string} ${string}` | 'none' | (string & {})>;
  transformOrigin?: Value<string>;
  translate?: Value<string>;
  rotate?: Value<Angle | 'none' | `${string} ${Angle}`>;
  scale?: Value<`${number}` | `${number} ${number}` | 'none'>;
  transition?: Value<string>;
  transitionProperty?: Value<string>;
  transitionDuration?: Value<Time>;
  transitionTimingFunction?: Value<'ease' | 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | `cubic-bezier(${string})` | `steps(${string})`>;
  transitionDelay?: Value<Time>;
  animation?: Value<string>;
  animationName?: Value<string>;
  animationDuration?: Value<Time>;
  animationTimingFunction?: Value<string>;
  animationDelay?: Value<Time>;
  animationIterationCount?: Value<number | 'infinite'>;
  animationDirection?: Value<'normal' | 'reverse' | 'alternate' | 'alternate-reverse'>;
  animationFillMode?: Value<'none' | 'forwards' | 'backwards' | 'both'>;
  animationPlayState?: Value<'running' | 'paused'>;
  filter?: Value<`blur(${string})` | `brightness(${string})` | `contrast(${string})` | `grayscale(${string})` | `opacity(${string})` | `saturate(${string})` | `sepia(${string})` | `hue-rotate(${string})` | `invert(${string})` | `drop-shadow(${string})` | `${string} ${string}` | 'none'>;
  backdropFilter?: Value<string>;
  objectFit?: Value<'fill' | 'contain' | 'cover' | 'none' | 'scale-down'>;
  objectPosition?: Value<string>;
  aspectRatio?: Value<`${number}/${number}` | `${number} / ${number}` | number | 'auto'>;
  resize?: Value<'none' | 'both' | 'horizontal' | 'vertical' | 'block' | 'inline'>;
  content?: Value<`"${string}"` | `'${string}'` | 'none' | 'normal' | `attr(${string})` | `counter(${string})` | `url(${string})` | (string & {})>;
  clipPath?: Value<`inset(${string})` | `circle(${string})` | `ellipse(${string})` | `polygon(${string})` | `path(${string})` | 'none'>;
  maskImage?: Value<string>;
  mixBlendMode?: Value<'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity'>;
  isolation?: Value<'auto' | 'isolate'>;
  scrollBehavior?: Value<'auto' | 'smooth'>;
  scrollSnapType?: Value<string>;
  scrollSnapAlign?: Value<'none' | 'start' | 'end' | 'center'>;
  scrollbarWidth?: Value<'auto' | 'thin' | 'none'>;
  scrollbarColor?: Value<`${Color} ${Color}` | 'auto'>;
  accentColor?: Value<Color | 'auto'>;
  caretColor?: Value<Color | 'auto'>;
  colorScheme?: Value<'light' | 'dark' | 'light dark' | 'dark light' | 'normal' | 'only light' | 'only dark'>;
  touchAction?: Value<'auto' | 'none' | 'pan-x' | 'pan-y' | 'manipulation' | `${string} ${string}`>;
  willChange?: Value<'auto' | 'scroll-position' | 'contents' | 'transform' | 'opacity' | `${string}, ${string}`>;
  contain?: Value<'none' | 'strict' | 'content' | 'size' | 'layout' | 'style' | 'paint' | `${string} ${string}`>;
  containerType?: Value<'normal' | 'size' | 'inline-size'>;
  containerName?: Value<string>;
  appearance?: Value<'none' | 'auto' | 'textfield' | 'menulist-button'>;
  fieldSizing?: Value<'fixed' | 'content'>;
}

/** The call/return shapes. */
export interface StyleRef {
  class: string;
  style?: Record<string, string>;
  toString(): string;
}

export type StyledFn<P> = (params: P) => StyleRef;
