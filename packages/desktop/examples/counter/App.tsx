import './style.css';

let count = 0;

function increment() {
  count++;
}

function decrement() {
  count--;
}

/** Ordinary component content: the caller retains the counter expressions. */
function Panel({ heading, children }: { heading: unknown; children: unknown }) {
  return (
    <section class="panel">
      <header>{heading}</header>
      {children}
    </section>
  );
}

export function App() {
  // JSX constants use the same compile-time alias semantics as the web target.
  const heading = <h2>Counter controls</h2>;

  return (
    <main class="counter">
      <h1>Memoized DOM with Blitz</h1>
      <p>Ordinary TSX, CSS and mount. Vite builds the application.</p>
      <Panel {...{ heading }}>
        <p class="value">Count: {count}</p>
        <div class="actions">
          <button onClick={increment}>Increment</button>
          <button onClick={decrement}>Decrement</button>
        </div>
      </Panel>
    </main>
  );
}
