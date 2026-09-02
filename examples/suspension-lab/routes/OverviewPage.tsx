export function OverviewPage() {
  return (
    <section class="page overview-page">
      <div class="hero-copy">
        <p class="eyebrow">Colorless async, made visible</p>
        <h1>One project. Two frontends. Two reveal strategies.</h1>
        <p>Every route loads the same three payloads at 900 ms, 2.1 s, and 3.4 s. The only variable is whether the component asks to suspend.</p>
        <div class="hero-actions">
          <a class="primary-link" route-to="/colorless-tsx">Watch local reveal</a>
          <a class="secondary-link" route-to="/suspended-tsrx">Watch atomic reveal</a>
        </div>
      </div>
      <div class="concept-grid">
        <article><span class="concept-number">01</span><h2>Colorless by default</h2><p>The shell mounts now. Only source-consuming sites wait.</p></article>
        <article><span class="concept-number">02</span><h2>Suspension is explicit</h2><p>One shorthand directive coordinates the component's first mount.</p></article>
        <article><span class="concept-number">03</span><h2>Frontend-neutral</h2><p>TSX and TSRX meet in the same ESTree analysis and runtime graph.</p></article>
      </div>
      <div class="timing-track" aria-label="Request timing">
        <span class="profile-time">Profile · 0.9 s</span>
        <span class="metrics-time">Metrics · 2.1 s</span>
        <span class="activity-time">Activity · 3.4 s</span>
      </div>
    </section>
  );
}
