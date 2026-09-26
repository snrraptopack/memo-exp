import { useRef } from 'react';
import { Badge, FancyInput } from 'wrapper-kit';

export function App() {
  const input = useRef<HTMLInputElement | null>(null);
  let label = 'A';
  let visible = true;
  let seen = 'unread';
  return <main>
    <button id="rename" onClick={() => { label = label === 'A' ? 'B' : 'A'; }}>rename</button>
    <button id="toggle" onClick={() => { visible = !visible; }}>toggle</button>
    <button id="check" onClick={() => { seen = input.current?.tagName ?? 'none'; }}>check</button>
    <output>{seen}</output>
    <Badge label={label} />
    {visible ? <FancyInput label={label} ref={input} /> : null}
  </main>;
}
