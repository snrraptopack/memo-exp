/**
 * jsx/svg.ts - compile-time DOM namespace selection for authored JSX tags.
 *
 * Parent context is authoritative. SVG-only roots are also recognized so an
 * imported icon component can return `<path>` without receiving a runtime
 * namespace argument through the component ABI.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const SVG_ONLY_TAGS = new Set([
  'animate',
  'animateMotion',
  'animateTransform',
  'circle',
  'clipPath',
  'defs',
  'desc',
  'ellipse',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feConvolveMatrix',
  'feDiffuseLighting',
  'feDisplacementMap',
  'feDistantLight',
  'feDropShadow',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feImage',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'fePointLight',
  'feSpecularLighting',
  'feSpotLight',
  'feTile',
  'feTurbulence',
  'filter',
  'g',
  'image',
  'line',
  'linearGradient',
  'marker',
  'mask',
  'metadata',
  'mpath',
  'path',
  'pattern',
  'polygon',
  'polyline',
  'radialGradient',
  'rect',
  'set',
  'stop',
  'switch',
  'symbol',
  'text',
  'textPath',
  'tspan',
  'use',
  'view',
]);

export function isSvgElement(tag: string, parentIsSvg: boolean): boolean {
  return parentIsSvg || tag === 'svg' || SVG_ONLY_TAGS.has(tag);
}

export function createElementExpression(
  document: t.Expression,
  tag: string,
  svg: boolean,
): t.CallExpression {
  return svg
    ? astFactory.callExpression(
        astFactory.memberExpression(
          cloneEstreeNode(document),
          astFactory.identifier('createElementNS'),
        ),
        [astFactory.stringLiteral(SVG_NAMESPACE), astFactory.stringLiteral(tag)],
      )
    : astFactory.callExpression(
        astFactory.memberExpression(
          cloneEstreeNode(document),
          astFactory.identifier('createElement'),
        ),
        [astFactory.stringLiteral(tag)],
      );
}
