/** Allocate native event sites and reuse the shared callback write plans. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { walkAst } from '../ast/walk';
import { unwrapTypeExpression } from '../ast/normalize';
import type { ComponentCallbacks, CallbackSourcePlan } from '../planning/component-callbacks';
import type { HandlerWritePlan } from '../handlers/plan';
import { valueExpression } from './value';

export const desktopEventNames = {
  onClick: 'click',
  onChange: 'change',
  onInput: 'change',
  onKeyDown: 'keydown',
  onKeyUp: 'keyup',
  onPointerDown: 'pointerdown',
  onPointerUp: 'pointerup',
  onFocus: 'focus',
  onBlur: 'blur',
  onSubmit: 'submit',
} as const;

// The registry normalizes authoring aliases to the scene protocol event names.
export type DesktopEventType = (typeof desktopEventNames)[keyof typeof desktopEventNames];

interface EventLoweringOptions {
  callbacks: ComponentCallbacks;
  instrument: t.Identifier;
  lexical?: boolean;
  fail(message: string, at: t.Node): never;
  routeWrites(plan: HandlerWritePlan): void;
  moduleCallback(expression: t.Expression): CallbackSourcePlan | null;
}

interface EventDestinations {
  events: { node: number; type: DesktopEventType }[];
  handlers: t.Expression[];
}

function supportedEvent(
  name: string,
  tag: string,
  allowed: readonly string[],
  options: EventLoweringOptions,
  at: t.Node,
): DesktopEventType {
  const event = desktopEventNames[name as keyof typeof desktopEventNames];
  if (!event || !allowed.includes(event)) {
    options.fail(`${name} is not supported on <${tag}>`, at);
  }
  return event;
}

/** A spread can contain authored callbacks whose writes still need publication. */
export function instrumentSpreadEvents(value: t.Expression, options: EventLoweringOptions): void {
  walkAst<t.Node>(value, {
    enter(current) {
      if (!b.isFunction(current)) return;
      const callback = options.callbacks.forValue(current as t.Expression);
      if (!callback) return;
      assertNoGeneratorCallbacks(callback.target, options.fail);
      options.routeWrites(callback.writesFor(undefined, true));
      for (const helper of callback.helpers) {
        assertNoGeneratorCallbacks(helper.target, options.fail);
        options.routeWrites(helper.writesFor());
      }
    },
  });
}

/** Property handlers are read at runtime, but authored writes are planned now. */
export function instrumentPropertyEvent(
  name: string,
  value: t.Expression,
  tag: string,
  allowed: readonly string[],
  options: EventLoweringOptions,
): void {
  supportedEvent(name, tag, allowed, options, value);
  const expression = unwrapTypeExpression(value) as t.Expression;
  const callback = options.callbacks.forEvent(expression) ?? options.moduleCallback(expression);
  if (!callback) return;
  assertNoGeneratorCallbacks(callback.target, options.fail);
  options.routeWrites(callback.writesFor(undefined, true));
  for (const helper of callback.helpers) {
    assertNoGeneratorCallbacks(helper.target, options.fail);
    options.routeWrites(helper.writesFor());
  }
}

/** Reserve stable protocol sites before a runtime spread reveals its callbacks. */
export function reserveDesktopEvents(
  node: number,
  allowed: readonly string[],
  destinations: EventDestinations,
  instrument: t.Identifier,
): Record<string, number> {
  const sites: Record<string, number> = {};
  for (const type of allowed) {
    sites[type] = destinations.events.length;
    destinations.events.push({ node, type: type as DesktopEventType });
    destinations.handlers.push(
      b.callExpression(instrument, [
        b.arrowFunctionExpression([], b.blockStatement([])),
        valueExpression([]),
      ]),
    );
  }
  return sites;
}

/** Emit an ordinary named handler with its precise or conservative write set. */
export function lowerDesktopEvent(
  name: string,
  expression: t.Expression,
  node: number,
  tag: string,
  allowed: readonly string[],
  seen: Set<string>,
  destinations: EventDestinations,
  options: EventLoweringOptions,
  at: t.Node,
): void {
  const event = supportedEvent(name, tag, allowed, options, at);
  if (seen.has(event)) {
    options.fail(`duplicate ${event === 'change' ? 'input change' : name} handler`, at);
  }
  seen.add(event);
  const localCallback = options.callbacks.forEvent(expression);
  const moduleCallback = localCallback ? null : options.moduleCallback(expression);
  const callback = localCallback ?? moduleCallback;
  if (!callback) options.fail(`${name} requires an inline callback or a linked helper`, at);
  assertNoGeneratorCallbacks(callback.target, options.fail);
  const plan = callback.writesFor(undefined, true);
  options.routeWrites(plan);
  for (const helper of callback.helpers) {
    assertNoGeneratorCallbacks(helper.target, options.fail);
    options.routeWrites(helper.writesFor());
  }
  const changed = new Set<string>();
  let conservative = plan.executionAwareRoot;
  for (const writes of plan.scopes.values()) {
    for (const key of writes.instanceWrites) changed.add(key.split('.')[0]!);
    conservative ||= writes.rootFallback || writes.eventFallback;
  }
  // Linked helpers and row closures can mutate state outside the local write set.
  conservative ||= callback.helpers.length > 0 || options.lexical === true;
  destinations.events.push({ node, type: event });
  destinations.handlers.push(
    b.callExpression(options.instrument, [
      moduleCallback && b.isExpression(moduleCallback.target) ? moduleCallback.target : expression,
      valueExpression(conservative ? null : [...changed].sort()),
    ]),
  );
}

export function assertNoGeneratorCallbacks(
  node: t.Node,
  fail: (message: string, at: t.Node) => never,
): void {
  walkAst(node, {
    enter(current) {
      if (
        current.type === 'YieldExpression' ||
        ('generator' in current && current.generator === true)
      )
        fail('generator callbacks require iterator lifecycle instrumentation', current);
    },
  });
}
