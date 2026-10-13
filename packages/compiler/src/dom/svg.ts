/**
 * DOM element allocation using the shared authored JSX namespace classifier.
 *
 * Parent context is authoritative. SVG-only roots are also recognized so an
 * imported icon component can return `<path>` without receiving a runtime
 * namespace argument through the component ABI.
 */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { cloneNode as cloneEstreeNode } from '../ast';
import { SVG_NAMESPACE } from '../jsx/namespaces';

export { isSvgElement } from '../jsx/namespaces';

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
