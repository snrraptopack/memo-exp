export function Overview() {
  return <section class="page">
    <p class="eyebrow">Implemented behavior, live</p>
    <h1>One loading policy. Different reveal strategies.</h1>
    <p>Use the tabs to compare cross-file Group inheritance with an atomic first mount.</p>
    <ol>
      <li>Progressive: titles and the input appear immediately; each row owns its data read.</li>
      <li>Atomic: all three requests start, but the board appears once after the slowest settles.</li>
      <li>Prepared detail: the previous page stays visible for two seconds before entry.</li>
    </ol>
    <p>There is no pre-entry Group route shell here. That integration is still pending.</p>
    <a class="action" route-to={{ path: '/progressive/:run', params: { run: 'first' } }}>
      Start with progressive rows
    </a>
  </section>;
}
