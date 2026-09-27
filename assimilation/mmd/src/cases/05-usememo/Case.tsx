export function UseMemoDerived() {
  let count = 1;
  let name = 'alpha';

  const doubled = count * 2;
  const label = `${name}:${doubled}`;

  return (
    <section>
      <h2>useMemo — derived chains</h2>
      <p data-testid="label">{label}</p>
      <button onClick={() => count++}>count +1</button>
      <button onClick={() => { name = name === 'alpha' ? 'beta' : 'alpha'; }}>
        rename
      </button>
    </section>
  );
}
