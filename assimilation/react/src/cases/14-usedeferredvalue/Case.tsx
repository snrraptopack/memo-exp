import { useDeferredValue, useMemo, useState } from 'react';

function makeRows(q: string) {
  const rows: string[] = [];
  for (let i = 0; i < 300; i++) rows.push(`${q} row ${i}`);
  return rows;
}

export function UseDeferredValueCase() {
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q);
  const stale = q !== deferred;
  const rows = useMemo(() => makeRows(deferred), [deferred]);
  return (
    <section>
      <h2>useDeferredValue — lagging mirror</h2>
      <input
        value={q}
        placeholder="type fast…"
        onChange={(e) => setQ(e.target.value)}
      />
      {stale && <em data-testid="stale"> stale…</em>}
      <ul>
        {rows.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </section>
  );
}
