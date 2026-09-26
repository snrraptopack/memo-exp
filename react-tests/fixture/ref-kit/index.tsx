import { useRef } from 'react';

function Field({ ref: forwarded }: { ref: unknown }) {
  return <input id="forwarded" ref={forwarded} />;
}

export function RefPanel() {
  const input = useRef<HTMLInputElement | null>(null);
  const nested = useRef<HTMLInputElement | null>(null);
  let visible = true;
  let seen = 'unread';
  return <section>
    <button id="toggle" onClick={() => { visible = !visible; }}>toggle</button>
    <button id="check" onClick={() => {
      seen = [input.current?.id ?? 'none', nested.current?.id ?? 'none'].join(',');
    }}>check</button>
    <output>{seen}</output>
    {visible ? <><input id="field" ref={input} /><Field ref={nested} /></> : null}
  </section>;
}
