/**
 * Root-scoped event delegation for compiler-owned repeated DOM.
 *
 * Elements carry two symbol-keyed slots per event type: their handler and the
 * root that owns it. This avoids a listener and a handler-record allocation
 * per row while allowing nested delegated roots to dispatch independently.
 */

interface DelegatedType {
  handler: symbol;
  root: symbol;
  roots: WeakSet<EventTarget>;
  type: string;
}

type DelegatedHost = EventTarget & Record<symbol, unknown>;

const delegatedTypes = new Map<string, DelegatedType>();
const delegatedJsxNames = new Map<string, DelegatedType>();

export function setDelegatedEvent(
  root: EventTarget,
  element: EventTarget,
  jsxName: string,
  handler: EventListener,
): void {
  let delegated = delegatedJsxNames.get(jsxName);
  if (delegated === undefined) {
    const type = eventType(jsxName);
    delegated = delegatedTypes.get(type);
    if (delegated === undefined) {
      delegated = {
        handler: Symbol(`memo-dom:${type}:handler`),
        root: Symbol(`memo-dom:${type}:root`),
        roots: new WeakSet(),
        type,
      };
      delegatedTypes.set(type, delegated);
    }
    delegatedJsxNames.set(jsxName, delegated);
  }

  const host = element as DelegatedHost;
  host[delegated.handler] = handler;
  host[delegated.root] = root;

  if (!delegated.roots.has(root)) {
    delegated.roots.add(root);
    root.addEventListener(delegated.type, (event) => {
      if (event.bubbles) dispatch(root, delegated!, event);
    });
    root.addEventListener(
      delegated.type,
      (event) => {
        if (!event.bubbles) dispatch(root, delegated!, event);
      },
      true,
    );
  }
}

function dispatch(
  root: EventTarget,
  delegated: DelegatedType,
  event: Event,
): void {
  const path = typeof event.composedPath === 'function'
    ? event.composedPath()
    : parentPath(event.target, root);
  for (const target of path) {
    const host = target as DelegatedHost;
    if (host[delegated.root] === root) {
      const handler = host[delegated.handler] as EventListener | undefined;
      if (handler !== undefined) {
        const result = (
          handler as (this: EventTarget, event: Event) => unknown
        ).call(target, event);
        if (result === false) event.preventDefault();
      }
    }
    if (target === root || event.cancelBubble) break;
  }
}

function parentPath(
  target: EventTarget | null,
  root: EventTarget,
): EventTarget[] {
  const path: EventTarget[] = [];
  let current = target;
  while (current !== null) {
    path.push(current);
    if (current === root) break;
    current = 'parentNode' in current
      ? (current as Node).parentNode
      : null;
  }
  return path;
}

function eventType(jsxName: string): string {
  const lowered = jsxName.startsWith('on')
    ? jsxName.slice(2).toLowerCase()
    : jsxName.toLowerCase();
  return lowered === 'doubleclick' ? 'dblclick' : lowered;
}
