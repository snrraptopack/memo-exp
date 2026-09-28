import {
  createRef, useDebugValue, useDeferredValue, useId, useImperativeHandle,
  useInsertionEffect, useLayoutEffect, useEffect, useRef, useState,
  useTransition, forwardRef,
} from 'react';

// Source order is deliberately scrambled: React guarantees insertion effects
// run before layout effects, which run before passive effects, regardless of
// declaration order inside the component.
export function Trace() {
  useDebugValue('trace');
  useInsertionEffect(() => { document.title += 'I'; });
  useEffect(() => { document.title += 'P'; });
  useLayoutEffect(() => { document.title += 'L'; });
  return <p>trace</p>;
}

export const Field = forwardRef(function Field(
  { label }: { label: string },
  ref: unknown,
) {
  const input = useRef<HTMLInputElement | null>(null);
  useImperativeHandle(ref, () => ({
    read() { return input.current?.value ?? 'none'; },
    clear() { if (input.current !== null) input.current.value = ''; },
  }));
  const id = useId();
  return <label for={id}>{label}<input id={id} ref={input} /></label>;
});

export function Pair() {
  return <section><Field label="a" /><Field label="b" /></section>;
}

export function Deferred() {
  const [query, setQuery] = useState('a');
  const deferred = useDeferredValue(query);
  const [pending, start] = useTransition();
  return <section>
    <button id="set" onClick={() => start(() => setQuery('b'))}>set</button>
    <output id="pending">{String(pending)}</output>
    <output id="value">{deferred}</output>
  </section>;
}

export function CreatedRef() {
  const box = createRef<HTMLInputElement>();
  const [seen, setSeen] = useState('empty');
  return <section>
    <input id="cr-input" ref={box} />
    <button id="cr-read" onClick={() => setSeen(box.current?.id ?? 'missing')}>read</button>
    <output id="cr-out">{seen}</output>
  </section>;
}
