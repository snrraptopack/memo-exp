function makeRows(q: string) {
  const rows: string[] = [];
  for (let i = 0; i < 300; i++) rows.push(`${q} row ${i}`);
  return rows;
}

export function UseDeferredValueCase() {
  let q = '';
  const deferred = q;
  const stale = q !== deferred;
  const rows = makeRows(deferred);
  return (
    <section>
      <h2>useDeferredValue — lagging mirror</h2>
      <input
        value={q}
        placeholder="type fast…"
        onInput={(e) => (q = e.currentTarget.value)}
      />
      {stale ? <em data-testid="stale"> stale…</em> : null}
      <ul>
        {rows.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </section>
  );
}
