function FancyInput({
  label,
  ref: forwardedRef,
}: {
  label: string;
  ref?: unknown;
}) {
  let clicks = 0;
  return (
    <label>
      <span>{label}</span>
      <input ref={forwardedRef} />
      <button class="inside" onClick={() => clicks++}>{clicks}</button>
    </label>
  );
}

function Badge({ label }: { label: string }) {
  return <strong>{label}</strong>;
}

export function MemoForwardRef() {
  const input = { current: null as HTMLInputElement | null };
  let label = 'A';
  let visible = true;
  let seen = 'unread';

  return (
    <section>
      <h2>memo + forwardRef</h2>
      <button id="rename" onClick={() => { label = label === 'A' ? 'B' : 'A'; }}>
        rename
      </button>
      <button id="toggle" onClick={() => { visible = !visible; }}>toggle</button>
      <button
        id="check"
        onClick={() => { seen = input.current?.tagName ?? 'none'; }}
      >
        check
      </button>
      <output data-testid="seen">{seen}</output>
      <Badge label={label} />
      {visible ? <FancyInput label={label} ref={input} /> : null}
    </section>
  );
}
