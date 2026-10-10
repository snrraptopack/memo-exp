import { state, doubled, rename, incrementLater } from './state';
import { addOne, subtractOne } from './commands';
import './app.css';

function Readout({ label }: { label: string }) {
  return (
    <article class="readout">
      <h2>{label}</h2>
      <p>{state.title}</p>
      <p class="count">Count: {state.count}</p>
      <p>Derived double: {doubled}</p>
    </article>
  );
}

function Controls() {
  return (
    <section class="controls">
      <p>Shared title</p>
      <input
        id="shared-title"
        aria-label="Shared title"
        type="text"
        value={state.title}
        onInput={event => rename(event.currentTarget.value)}
      />
      <div class="actions">
        <button onClick={addOne}>Increment</button>
        <button onClick={subtractOne}>Decrement</button>
        <button onClick={incrementLater}>Increment after 500 ms</button>
      </div>
    </section>
  );
}

export function App() {
  return (
    <main class="page">
      <section id="shared-workspace" class="workspace">
        <h1>Shared desktop reactivity</h1>
        <p>Both panels read the same state module. The controls call helpers from another file.</p>
        <Controls />
        <div class="readouts">
          <Readout label="First component instance" />
          <Readout label="Second component instance" />
        </div>
      </section>
    </main>
  );
}
