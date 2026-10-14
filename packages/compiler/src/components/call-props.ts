/** Named JSX props converted to an authored component's parameter contract. */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  cloneNode,
  isValidIdentifier,
} from '../ast';
import type { ComponentPropsPlan } from './props';

export interface ComponentPropContext {
  readonly componentProps: ReadonlyMap<string, ComponentPropsPlan>;
}

export interface ComponentPropEntry {
  readonly name: string;
  readonly value: t.Expression;
}

/**
 * Preserve the framework's existing positional/object component ABI.
 * Presentation backends supply the same analyzed prop contract.
 */
export function orderCallProps(
  context: ComponentPropContext,
  tag: string,
  entries: readonly ComponentPropEntry[],
): t.Expression[] {
  const plan = context.componentProps.get(tag);

  if (plan?.mode === 'object') {
    assertKnownProps(plan, tag, entries);

    if (entries.length === 0 && plan.hasWholeDefault) {
      return [astFactory.identifier('undefined')];
    }

    return [
      astFactory.objectExpression(
        entries.map((entry) =>
          astFactory.objectProperty(
            astFactory.identifier(entry.name),
            entry.value,
            false,
            astFactory.isIdentifier(entry.value) &&
              entry.value.name === entry.name,
          ),
        ),
      ),
    ];
  }

  const declared = plan?.names;

  if (plan === undefined || declared === undefined) {
    return entries.map((entry) => entry.value);
  }

  const byName = new Map(
    entries.map((entry) => [entry.name, entry.value]),
  );

  assertKnownProps(plan, tag, entries);

  return declared.map(
    (name) => byName.get(name) ?? astFactory.identifier('undefined'),
  );
}

/** Convert an already ordered/spread object into the component parameter ABI. */
export function callPropsFromObject(
  context: ComponentPropContext,
  tag: string,
  object: t.Expression,
): t.Expression[] {
  const plan = context.componentProps.get(tag);

  if (plan?.mode === 'object') {
    return [cloneNode(object)];
  }

  return (plan?.names ?? []).map((name) =>
    astFactory.memberExpression(
      cloneNode(object),
      isValidIdentifier(name)
        ? astFactory.identifier(name)
        : astFactory.stringLiteral(name),
      !isValidIdentifier(name),
    ),
  );
}

function assertKnownProps(
  plan: ComponentPropsPlan,
  tag: string,
  entries: readonly ComponentPropEntry[],
): void {
  if (plan.acceptsUnknown) {
    return;
  }

  for (const entry of entries) {
    if (!plan.names.includes(entry.name)) {
      throw new Error(
        `memo-dom: unknown prop '${entry.name}' on <${tag}> - declared props: ${
          plan.names.length > 0 ? plan.names.join(', ') : '(none)'
        }`,
      );
    }
  }
}
