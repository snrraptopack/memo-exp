import { useMemo, useState } from 'react';

export function UseMemoDerived() {
  const [count, setCount] = useState(1);
  const [name, setName] = useState('alpha');

  const doubled = useMemo(() => count * 2, [count]);
  const label = useMemo(() => `${name}:${doubled}`, [name, doubled]);

  return (
    <section>
      <h2>useMemo — derived chains</h2>
      <p data-testid="label">{label}</p>
      <button onClick={() => setCount((c) => c + 1)}>count +1</button>
      <button
        onClick={() => setName((n) => (n === 'alpha' ? 'beta' : 'alpha'))}
      >
        rename
      </button>
    </section>
  );
}
