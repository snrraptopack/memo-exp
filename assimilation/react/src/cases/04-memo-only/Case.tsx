import { memo, useRef, useState } from 'react';

const Label = memo(function Label({ text }: { text: string }) {
  const renders = useRef(0);
  renders.current += 1;
  return (
    <p>
      <strong data-testid="text">{text}</strong>{' '}
      <small data-testid="renders">(body ran {renders.current}×)</small>
    </p>
  );
});

export function MemoOnly() {
  const [tick, setTick] = useState(0);
  const [text, setText] = useState('hello');

  return (
    <section>
      <h2>memo — erased wrapper</h2>
      <p>
        parent tick: <span data-testid="tick">{tick}</span>
      </p>
      <button id="tick" onClick={() => setTick((t) => t + 1)}>
        unrelated parent update
      </button>
      <button
        id="prop"
        onClick={() => setText((t) => (t === 'hello' ? 'world' : 'hello'))}
      >
        change prop
      </button>
      <Label text={text} />
    </section>
  );
}
