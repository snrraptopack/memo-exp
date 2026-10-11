import { state, doubled, rename, incrementLater, incrementInPhases } from './state';
import { addOne, subtractOne } from './commands';
import './app.css';

function Readout({ label }: { label: string }) {
  const heading = label.toUpperCase();
  const parity = state.count % 2 === 0 ? 'Even' : 'Odd';

  let paragraph: HTMLParagraphElement | undefined;
  let acceptedCount = 0;
  let acceptedTag = '';

  // The native paragraph ref is available before this accepted-render effect.
  // Its tagName is a native handle capability; browser document APIs are not
  // supplied by the desktop target.
  $effect(() => {
    acceptedCount = state.count;
    acceptedTag = paragraph?.tagName ?? '';
  });

  // The shared ref lifecycle clears this binding when its owner is disposed.
  return (
    <article class="readout">
      <h2>{heading}</h2>
      <p>{state.title}</p>
      <p class="count">Count: {state.count}</p>
      <p>Derived double: {doubled}</p>
      <p>Component calculation: {parity}</p>
      <p ref={paragraph}>
        Accepted effect: count {acceptedCount}, native tag {acceptedTag}
      </p>
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
        onInput={(event) => rename(event.currentTarget.value)}
      />
      <div class="actions">
        <button id="shared-increment" onClick={addOne}>
          Increment
        </button>
        <button onClick={subtractOne}>Decrement</button>
        <button id="delayed-increment" onClick={incrementLater}>
          Increment after 500 ms
        </button>
        <button id="phased-increment" onClick={incrementInPhases}>
          Increment now and after 500 ms
        </button>
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
