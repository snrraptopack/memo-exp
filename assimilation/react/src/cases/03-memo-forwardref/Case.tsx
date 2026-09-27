import { forwardRef, memo, useRef, useState } from 'react';

const FancyInput = memo(
  forwardRef<HTMLInputElement, { label: string }>(function FancyInput(
    { label },
    ref,
  ) {
    const [clicks, setClicks] = useState(0);
    return (
      <label>
        <span>{label}</span>
        <input ref={ref} />
        <button className="inside" onClick={() => setClicks((c) => c + 1)}>
          {clicks}
        </button>
      </label>
    );
  }),
);

const Badge = memo(function Badge({ label }: { label: string }) {
  return <strong>{label}</strong>;
});

export function MemoForwardRef() {
  const input = useRef<HTMLInputElement | null>(null);
  const [label, setLabel] = useState('A');
  const [visible, setVisible] = useState(true);
  const [seen, setSeen] = useState('unread');

  return (
    <section>
      <h2>memo + forwardRef</h2>
      <button id="rename" onClick={() => setLabel((l) => (l === 'A' ? 'B' : 'A'))}>
        rename
      </button>
      <button id="toggle" onClick={() => setVisible((v) => !v)}>
        toggle
      </button>
      <button
        id="check"
        onClick={() => setSeen(input.current?.tagName ?? 'none')}
      >
        check
      </button>
      <output data-testid="seen">{seen}</output>
      <Badge label={label} />
      {visible ? <FancyInput label={label} ref={input} /> : null}
    </section>
  );
}
