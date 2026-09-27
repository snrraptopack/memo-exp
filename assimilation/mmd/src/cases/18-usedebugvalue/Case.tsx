export function UseDebugValueCase() {
  let n = 0;
  return (
    <section>
      <h2>useDebugValue — devtools label only</h2>
      <p>
        count: <span data-testid="count">{n}</span>
      </p>
      <button onClick={() => n++}>+1</button>
      <p>
        <small>
          Nothing renders differently — useDebugValue only labels the hook in
          React DevTools. The MMD twin erases it outright.
        </small>
      </p>
    </section>
  );
}
