function Label({ text }: { text: string }) {
  let renders = 0;
  renders += 1;
  return (
    <p>
      <strong data-testid="text">{text}</strong>{' '}
      <small data-testid="renders">(body ran {renders}×)</small>
    </p>
  );
}

export function MemoOnly() {
  let tick = 0;
  let text = 'hello';

  return (
    <section>
      <h2>memo — erased wrapper</h2>
      <p>
        parent tick: <span data-testid="tick">{tick}</span>
      </p>
      <button id="tick" onClick={() => tick++}>unrelated parent update</button>
      <button id="prop" onClick={() => { text = text === 'hello' ? 'world' : 'hello'; }}>
        change prop
      </button>
      <Label text={text} />
    </section>
  );
}
