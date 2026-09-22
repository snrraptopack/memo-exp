import { Home } from './src/Home';
import { ExpeditionList } from './src/ExpeditionList';
import { ExpeditionDetail } from './src/ExpeditionDetail';
import { About } from './src/About';

export function Main() {
  return (
    <main>
      <header class="app">
        <h1>Fieldnotes</h1>
        <nav>
          <a route-to="/">Home</a>
          <a route-to="/expeditions">Expeditions</a>
          <a route-to="/about">About</a>
        </nav>
      </header>

      <Home route="/" />

      {/* Shared layout for everything under /expeditions/* — the heading
          stays mounted while the child region swaps between the list and
          the detail page. */}
      <section route="/expeditions" class="card">
        <h2>Expeditions</h2>
        <ExpeditionList route="/" />
        <ExpeditionDetail route="/:id" />
      </section>

      <About route="/about" />
      <NotFound route="/*" />
    </main>
  );
}

function NotFound() {
  return (
    <section class="card">
      <h2>Lost trail</h2>
      <p>Nothing lives at this path.</p>
      <a class="back" route-to="/">← Back to base camp</a>
    </section>
  );
}
