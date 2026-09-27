export function UseCallbackStep() {
  let step = 1;
  let count = 0;

  const advance = () => {
    count += step;
  };

  return (
    <section>
      <h2>useCallback — dep-driven closure</h2>
      <p>
        count: <span data-testid="count">{count}</span>, step:{' '}
        <span data-testid="step">{step}</span>
      </p>
      <button onClick={advance}>+ step</button>
      <button onClick={() => step++}>raise step</button>
      <button onClick={() => (step = 1)}>reset step</button>
    </section>
  );
}
