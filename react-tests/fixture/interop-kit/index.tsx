import { useId, useState, useTransition } from 'react';

export function Mixed() {
  let native = 0;
  const [react, setReact] = useState(10);
  const [pending, start] = useTransition();
  const id = useId();
  return <section id={id}>
    <button id="native" onClick={() => { native++; }}>{native}</button>
    <button id="react" onClick={() => start(() => setReact(react + 5))}>{react}</button>
    <output id="pending">{String(pending)}</output>
  </section>;
}
