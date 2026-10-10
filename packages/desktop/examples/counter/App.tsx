import type {} from '@memoized-dom/compiler/jsx';
import { CounterDetails } from './CounterDetails';
import './app.css';

export function App() {
  let count = 0;
  let input = "";
  return <main id="app" class="card">
    <header><h1>Memoized DOM desktop</h1><p class="intro">Real TSX, normal mount, native rendering.</p></header>
    <section class="counter">
      <p class="value">Count: <strong>{count}</strong></p>
      <div class="actions">
        <button onClick={() => count++}>Increment</button>
        <button onClick={() => count--}>Decrement</button>
      </div>

      <input type="text" value={input} onChange={event => input = event.currentTarget.value} />
      <p id="input-echo">Typed: {input}</p>
    </section>
    <CounterDetails count={count} value={input} />
    <section class="samples">
      <h2>Native tag and CSS playground</h2>
      <p>A paragraph with <strong>bold</strong>, <em>italic</em>, <code>inline code</code> and <mark>highlighted text</mark>.</p>
      <p>Unicode: 静的 🙂 café. <span class="accent">This span is styled inside the same paragraph.</span></p>
      <p>Line one<br />Line two</p>
      <div id="grid" class="grid">
        <div id="tile-a" class="tile"><p>CSS grid column one</p></div>
        <div id="tile-b" class="tile"><p>CSS grid column two</p></div>
      </div>
      <p id="wrap-wide" class="wrap-wide">The same paragraph wraps through native text measurement when CSS gives it a different width.</p>
      <p id="wrap-narrow" class="wrap-narrow">The same paragraph wraps through native text measurement when CSS gives it a different width.</p>
      <blockquote>Resize the window to test text wrapping and layout constraints.</blockquote>
    </section>
  </main>;
}
