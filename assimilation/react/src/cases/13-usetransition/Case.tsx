import { useMemo, useState, useTransition } from 'react';

function makeRows(q: string) {
  const rows: string[] = [];
  for (let i = 0; i < 300; i++) rows.push(`${q} row ${i}`);
  return rows;
}

export function UseTransitionCase() {
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState('');
  const rows = useMemo(() => makeRows(q), [q]);
  return (
    <section>
      <h2>useTransition — deferred list update</h2>
      <input
        value={q}
        placeholder="type fast…"
        onChange={(e) => startTransition(() => setQ(e.target.value))}
      />
      {pending && <em data-testid="pending"> pending…</em>}
      <ul>
        {rows.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </section>
  );
}
