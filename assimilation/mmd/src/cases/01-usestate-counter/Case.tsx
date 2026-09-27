export function UseStateCounter() {
  let count = 0;
  const doubled = count * 2;

  return (
    <section>
      <h2>useState counter</h2>
      <p>
        count: <span data-testid="count">{count}</span>
      </p>
      <p>
        doubled: <span data-testid="doubled">{doubled}</span>
      </p>
      <button onClick={() => count++}>+1</button>
      <button onClick={() => count--}>-1</button>
      <button onClick={() => (count = 0)}>reset</button>
    </section>
  );
}
