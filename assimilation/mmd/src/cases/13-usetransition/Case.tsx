function makeRows(q: string) {
  const rows: string[] = [];
  for (let i = 0; i < 300; i++) rows.push(`${q} row ${i}`);
  return rows;
}

export function UseTransitionCase() {
  const pending = false;
  let q = '';
  const rows = makeRows(q);
  return (
    <section>
      <h2>useTransition — deferred list update</h2>
      <input
        value={q}
        placeholder="type fast…"
        onInput={(e) => (q = e.currentTarget.value)}
      />
      {pending ? <em data-testid="pending"> pending…</em> : null}
      <ul>
        {rows.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </section>
  );
}
