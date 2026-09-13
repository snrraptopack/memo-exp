/** Shared parsing and removal of the compiler-owned suspend directive. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';

export function suspendDirective(
  element: t.JSXElement,
  errorAt: { buildCodeFrameError(message: string, at?: t.Node): Error },
): t.JSXAttribute | null {
  const attribute = element.openingElement.attributes.find(
    (candidate) =>
      astFactory.isJSXAttribute(candidate) &&
      astFactory.isJSXIdentifier(candidate.name, { name: 'suspend' }),
  );
  if (!astFactory.isJSXAttribute(attribute)) return null;
  if (attribute.value !== null) {
    throw errorAt.buildCodeFrameError(
      "memo-dom: suspend is a shorthand compiler directive; write 'suspend' without a value",
      attribute,
    );
  }
  return attribute;
}

export function consumeSuspendDirective(
  element: t.JSXElement,
  attribute: t.JSXAttribute,
): void {
  const index = element.openingElement.attributes.indexOf(attribute);
  if (index !== -1) element.openingElement.attributes.splice(index, 1);
}
