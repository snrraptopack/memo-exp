import './style.css';

let count = 0;

function increment() {
  count++;
}

function decrement() {
  count--;
}

/** Ordinary component content: the caller retains the counter expressions. */
function Panel({ children }: { children: unknown }) {
  return <section class="panel">{children}</section>;
}

export function App() {
  return (
    <main class="counter">
      <h1>Memoized DOM with Blitz</h1>
      <p>Ordinary TSX, CSS and mount. Vite builds the application.</p>
      <Panel>
        <p class="value">Count: {count}</p>
        <div class="actions">
          <button onClick={increment}>Increment</button>
          <button onClick={decrement}>Decrement</button>
        </div>
      </Panel>
    </main>
  );
}
