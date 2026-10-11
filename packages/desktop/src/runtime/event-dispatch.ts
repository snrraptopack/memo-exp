import type { NativeSceneEvent, SceneHandle, SceneTemplate } from '../bridge/protocol';
import type { Owner } from './ownership-model';
import { authoredEvent } from './events';

interface DispatcherHooks {
  find(handle: SceneHandle): Owner | undefined;
  invalidate(owner: Owner, sources: readonly string[] | null): void;
  flush(owner: Owner): Promise<void>;
  isClosed(): boolean;
  reportAsync(error: unknown): void;
}

interface Position {
  owner: Owner;
  node: number;
}

type ElementSnapshot = Record<string, unknown>;

function payloadFields(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}

function eventPath(position: Position): Position[] {
  const path: Position[] = [];
  let current: Position | undefined = position;

  while (current) {
    const { owner, node }: Position = current;
    const definition: SceneTemplate['nodes'][number] = owner.template.nodes[node]!;
    if (definition.kind === 'element') path.push(current);

    if (definition.parent !== null) {
      current = { owner, node: definition.parent };
    } else if (owner.parent && owner.attachment) {
      // A component's authored roots continue through its attachment region.
      // This lets a parent handler receive events from an independent child owner.
      current = { owner: owner.parent, node: owner.attachment.node };
    } else {
      current = undefined;
    }
  }

  return path;
}

function elementSnapshot({ owner, node }: Position, extra?: unknown): ElementSnapshot {
  const definition = owner.template.nodes[node]!;
  if (definition.kind !== 'element') {
    throw new Error('Native event target is not an element');
  }

  const attributes = definition.attributes ?? {};
  const valueBinding = owner.bindings.find((binding) => {
    const slot = owner.template.slots[binding.slot];
    return slot?.node === node && slot.type === 'value';
  });
  const value = valueBinding?.read();

  // Native editing fields take precedence: they may be newer than the last
  // JavaScript publication. These are element snapshots, not DOM instances.
  return {
    ...attributes,
    id: attributes.id ?? '',
    tagName: definition.tag.toUpperCase(),
    value: value === undefined ? (attributes.value ?? '') : String(value),
    ...payloadFields(extra),
  };
}

/** Route platform events through lexical owners, then publish one family update. */
export function createEventDispatcher({
  find,
  invalidate,
  flush,
  isClosed,
  reportAsync,
}: DispatcherHooks) {
  const canceledSpace = new WeakMap<Owner, Set<number>>();

  return async function dispatchEvent(native: NativeSceneEvent): Promise<boolean> {
    const owner = find(native.handle);
    const retired =
      !owner || owner.disposed || owner.instance.handle.generation !== native.handle.generation;

    if (retired || isClosed()) {
      throw new Error('Native desktop event targets an unknown or retired owner');
    }

    await owner.instance.ready;

    const site = native.site === undefined ? undefined : owner.template.events[native.site];
    if (native.site !== undefined && !site) {
      throw new Error('Unknown desktop event');
    }

    const node = native.node ?? site?.node;
    const fields = payloadFields(native.payload);
    const type = typeof fields.type === 'string' ? fields.type : site?.type;
    if (
      node === undefined ||
      !owner.template.nodes[node] ||
      !type ||
      (site && site.node !== node)
    ) {
      throw new Error('Invalid native event target');
    }

    const path = eventPath({ owner, node });
    const snapshots = path.map((position) => {
      const isTarget = position.owner === owner && position.node === node;
      return elementSnapshot(position, isTarget ? fields.target : undefined);
    });
    const errors: unknown[] = [];

    function runHandlers(
      kind: string,
      route: Position[],
      targets: ElementSnapshot[],
      payload: unknown,
    ): boolean {
      const state = authoredEvent(kind, payload, targets[0]!);
      state.path(targets);

      try {
        for (let index = 0; index < route.length; index++) {
          const position = route[index]!;
          if (position.owner.disposed) continue;

          state.enter(targets[index]!, index === 0);

          for (let site = 0; site < position.owner.template.events.length; site++) {
            const definition = position.owner.template.events[site]!;
            if (definition.node !== position.node || definition.type !== kind) continue;

            const handler = position.owner.handlers[site]!;
            try {
              const result = Reflect.apply(handler.callback, undefined, [state.event]);
              if (result instanceof Promise) {
                // Cancellation belongs to this event turn. Continuations
                // publish separately and retain their errors for app.flush().
                void result
                  .finally(() => {
                    if (!position.owner.disposed && !isClosed())
                      invalidate(position.owner, handler.sources);
                  })
                  .catch(reportAsync);
              }
            } catch (error) {
              errors.push(error);
            }

            // Record every affected owner before publishing. A child's handler
            // and its parent's handler must appear in the same family update.
            invalidate(position.owner, handler.sources);
            if (state.immediate) break;
          }

          if (state.stopped) break;
        }
      } finally {
        state.finish();
      }

      return state.event.defaultPrevented;
    }

    function submitForm(submitter: ElementSnapshot | null): void {
      const formIndex = snapshots.findIndex((element) => element.tagName === 'FORM');
      if (formIndex < 0) return;

      runHandlers('submit', path.slice(formIndex), snapshots.slice(formIndex), {
        submitter,
        isTrusted: fields.isTrusted,
      });
    }

    const prevented = runHandlers(type, path, snapshots, fields);
    const target = snapshots[0]!;
    const isButton = target.tagName === 'BUTTON';

    // Space activates a button on release. Remember cancellation from keydown
    // so an uncanceled keyup cannot accidentally restore that default action.
    if (type === 'keydown' && isButton && fields.key === ' ') {
      const nodes = canceledSpace.get(owner) ?? new Set<number>();
      if (prevented) {
        nodes.add(node);
      } else {
        nodes.delete(node);
      }
      canceledSpace.set(owner, nodes);
    }

    const spacePrevented =
      type === 'keyup' && fields.key === ' ' && canceledSpace.get(owner)?.delete(node);

    if (!prevented && !fields.isComposing) {
      const enterActivation = type === 'keydown' && isButton && fields.key === 'Enter';
      const spaceActivation = type === 'keyup' && isButton && fields.key === ' ' && !spacePrevented;
      let clicked = type === 'click';

      if (enterActivation || spaceActivation) {
        clicked = !runHandlers('click', path, snapshots, {
          detail: 0,
          button: 0,
          isTrusted: fields.isTrusted,
        });
      }

      if (clicked && isButton && (target.type ?? 'submit') === 'submit') {
        submitForm(target);
      }
      if (type === 'keydown' && target.tagName === 'INPUT' && fields.key === 'Enter') {
        submitForm(null);
      }
    }

    // Defaults and bubbling share one publication. Native Tab navigation waits
    // for the process host's separate acknowledgment of `prevented`.
    try {
      await flush(owner);
    } catch (error) {
      errors.push(error);
    }

    if (errors.length) throw new AggregateError(errors, 'Desktop event dispatch failed');
    return prevented;
  };
}
