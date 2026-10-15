import './style.css';

let count = 0;
let reversed = false;
let thirdRowVisible = true;

function increment() {
  count++;
}

function decrement() {
  count--;
}

function reverseRows() {
  reversed = !reversed;
}

function toggleThirdRow() {
  thirdRowVisible = !thirdRowVisible;
}

/** Keys retain each native row while its current index and content replay. */
function CounterRows({ items }: { items: readonly number[] }) {
  return (
    <ul class="keyed-rows">
      {items.map((value, index) => (
        <li key={value}>
          <span class="row-position">Position {index + 1}</span>
          <button onClick={() => { count += value; }}>Add {value}</button>
          <span class="row-count">Shared count: {count}</span>
        </li>
      ))}
    </ul>
  );
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
      <section class="panel">
        <h2>Keyed row events</h2>
        <p>Click a row, reverse the order, then remove and restore row 3.</p>
        <div class="actions">
          <button onClick={reverseRows}>Reverse rows</button>
          <button onClick={toggleThirdRow}>Toggle row 3</button>
        </div>
        <CounterRows items={
          thirdRowVisible
            ? (reversed ? [3, 2, 1] : [1, 2, 3])
            : (reversed ? [2, 1] : [1, 2])
        } />
      </section>
    </main>
  );
}
