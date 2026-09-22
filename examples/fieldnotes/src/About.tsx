export function About() {
  return (
    <section class="card">
      <h2>About</h2>
      <p>
        Fieldnotes is a tiny expedition journal: a list of expeditions, each
        with its own notes. The list loads through a server function; each
        detail page is prepared by a server-backed <code>$routed</code>{' '}
        callback that reads the database through <code>services</code> —
        code that never ships to the browser.
      </p>
      <p class="muted">
        Artificial latency is added to every request so the pending, error,
        and tracked states are visible.
      </p>
    </section>
  );
}
