/** Existing JSX-to-attribute spellings shared by presentation hosts. */
const ATTRIBUTE_NAMES: Record<string, string> = {
  className: 'class',
  htmlFor: 'for',
  readOnly: 'readonly',
  autoFocus: 'autofocus',
  autoPlay: 'autoplay',
  tabIndex: 'tabindex',
  crossOrigin: 'crossorigin',
};
const SVG_ATTRIBUTE_NAMES: Record<string, string> = {
  className: 'class',
  clipPath: 'clip-path',
  clipRule: 'clip-rule',
  colorInterpolation: 'color-interpolation',
  colorInterpolationFilters: 'color-interpolation-filters',
  dominantBaseline: 'dominant-baseline',
  fillOpacity: 'fill-opacity',
  fillRule: 'fill-rule',
  floodColor: 'flood-color',
  floodOpacity: 'flood-opacity',
  fontFamily: 'font-family',
  fontSize: 'font-size',
  markerEnd: 'marker-end',
  markerMid: 'marker-mid',
  markerStart: 'marker-start',
  stopColor: 'stop-color',
  stopOpacity: 'stop-opacity',
  strokeDasharray: 'stroke-dasharray',
  strokeDashoffset: 'stroke-dashoffset',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  strokeMiterlimit: 'stroke-miterlimit',
  strokeOpacity: 'stroke-opacity',
  strokeWidth: 'stroke-width',
  textAnchor: 'text-anchor',
  vectorEffect: 'vector-effect',
  xlinkHref: 'xlink:href',
};
export function jsxAttributeName(name: string, html: boolean): string {
  return html
    ? ATTRIBUTE_NAMES[name] ?? name
    : SVG_ATTRIBUTE_NAMES[name] ?? ATTRIBUTE_NAMES[name] ?? name;
}
