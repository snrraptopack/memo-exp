const modifierFields: Readonly<Record<string, string>> = {
  Alt: 'altKey',
  Control: 'ctrlKey',
  Meta: 'metaKey',
  Shift: 'shiftKey',
};

/** DOM-shaped event behavior over serializable native fields. No DOM dependency. */
export function authoredEvent(type: string, payload: unknown, target: object) {
  const fields = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};

  let currentTarget: object | null = null;
  let eventPhase = 0;
  let stopped = false;
  let immediate = false;
  let prevented = false;
  let path: object[] = [];

  const isFocusEvent = type === 'focus' || type === 'blur';
  const cancelable = fields.cancelable !== false && !isFocusEvent && type !== 'change';
  const bubbles = !isFocusEvent;

  // Keep cancellation in JavaScript until the host receives its acknowledgment.
  // Already-applied native editing actions explicitly arrive as noncancelable.
  const event = {
    ...fields,
    type,
    target,
    bubbles,
    cancelable,
    isTrusted: fields.isTrusted === true,
    timeStamp: typeof fields.timeStamp === 'number' ? fields.timeStamp : performance.now(),

    get currentTarget() {
      return currentTarget;
    },
    get eventPhase() {
      return eventPhase;
    },
    get defaultPrevented() {
      return prevented;
    },
    get cancelBubble() {
      return stopped;
    },
    set cancelBubble(value: boolean) {
      if (value) stopped = true;
    },
    get returnValue() {
      return !prevented;
    },
    set returnValue(value: boolean) {
      if (!value && cancelable) prevented = true;
    },

    preventDefault() {
      if (cancelable) prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
    stopImmediatePropagation() {
      stopped = true;
      immediate = true;
    },
    getModifierState(key: string) {
      const field = modifierFields[key];
      return field !== undefined && fields[field] === true;
    },
    composedPath() {
      return [...path];
    },
  };

  return {
    event,
    get stopped() {
      return stopped || !bubbles;
    },
    get immediate() {
      return immediate;
    },
    path(elements: object[]) {
      path = elements;
    },
    enter(element: object, atTarget: boolean) {
      currentTarget = element;
      eventPhase = atTarget ? 2 : 3;
    },
    finish() {
      currentTarget = null;
      eventPhase = 0;
      path = [];
    },
  };
}
