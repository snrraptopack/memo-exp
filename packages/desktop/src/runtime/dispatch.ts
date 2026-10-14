/** Synchronous event routing over accepted source addresses, using core scopes. */
import type { NativeEventPacket } from '../host/events';
import type { NativePresentation } from './view';

export function dispatchNativeEvent(
  view: NativePresentation | undefined,
  packet: NativeEventPacket,
  reportError: (error: unknown) => void
): boolean {
  if (!view || !view.matchesSource(packet.path[0]!)) return true;
  let dispatching = true;
  let cancelled = false;
  let stopped = false;
  let immediate = false;
  const targets = new Map<string, object>();

  function targetFor(source: NativeEventPacket['path'][number]): object {
    const key = `${source.owner.id}:${source.owner.generation}:${source.source}`;
    let target = targets.get(key);

    if (!target) {
      target = view!.eventTarget(source);
      targets.set(key, target);
    }

    return target;
  }

  const target = targetFor(packet.path[0]!);
  let currentTarget: object | null = null;
  let phase = 0;

  // This is an ordinary event interface with a bounded native source target.
  // Unsupported target operations fail explicitly; no DOM element is invented.
  const event = {
    type: packet.eventType,
    bubbles: packet.bubbles,
    cancelable: packet.cancelable,
    timeStamp: packet.timestamp,
    isTrusted: true,
    target,
    get currentTarget() {
      return currentTarget;
    },
    get eventPhase() {
      return phase;
    },
    get defaultPrevented() {
      return cancelled;
    },
    get cancelBubble() {
      return stopped;
    },
    preventDefault() {
      if (dispatching && packet.cancelable) {
        cancelled = true;
      }
    },
    stopPropagation() {
      if (dispatching) {
        stopped = true;
      }
    },
    stopImmediatePropagation() {
      if (dispatching) {
        stopped = true;
        immediate = true;
      }
    },
    composedPath: () => packet.path
      .filter(source => view.matchesSource(source))
      .map(source => targetFor(source))
  };

  function invoke(index: number, name: string, eventPhase: number): void {
    const source = packet.path[index]!;
    if (!view!.matchesSource(source)) return;
    currentTarget = targetFor(source);
    phase = eventPhase;
    try {
      const result = view!.dispatch(source, name, event);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(reportError);
      }
    } catch (error) {
      reportError(error);
    }
  }

  try {
    for (let index = packet.path.length - 1; index >= 0; index--) {
      invoke(index, 'onClickCapture', index === 0 ? 2 : 1);
      if (stopped && index !== 0) return cancelled;
      if (immediate) return cancelled;
    }
    for (let index = 0; index < packet.path.length; index++) {
      if (index > 0 && (!packet.bubbles || stopped)) break;
      invoke(index, 'onClick', index === 0 ? 2 : 3);
      if (immediate) break;
    }
    return cancelled;
  } finally {
    dispatching = false;
    currentTarget = null;
    phase = 0;
  }
}
