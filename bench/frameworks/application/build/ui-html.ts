import { copyFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function writeApplicationUi(root: string): void {
  copyFileSync(resolve(root, 'latest.json'), resolve(root, 'dist/latest.json'));
  writeFileSync(resolve(root, 'dist/index.html'), HTML, 'utf8');
}

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Application benchmark</title>
  <style>
    :root{color-scheme:dark;--bg:#08110f;--panel:#111d19;--panel2:#162620;--line:#2a3d36;--muted:#92a9a1;--text:#f3f8f6;--accent:#86e8b1;--error:#ff9891;--warn:#f1cd7a}
    *{box-sizing:border-box}[hidden]{display:none!important}
    body{margin:0;background:radial-gradient(circle at 12% -5%,#194432 0,transparent 32%),var(--bg);color:var(--text);font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}
    button,select{font:inherit}button:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .page{width:min(1380px,calc(100% - 32px));margin:auto;padding:28px 0 48px}
    .masthead{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
    .eyebrow{margin:0 0 6px;color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
    h1{margin:0;font-size:clamp(28px,4vw,46px);font-weight:670;letter-spacing:-.045em}
    .lede{max-width:670px;margin:8px 0 0;color:var(--muted);font-size:15px}
    .status{flex:none;max-width:500px;margin-top:7px;padding:8px 12px;border:1px solid var(--line);border-radius:999px;color:var(--muted);background:#0b1512}
    .status[data-tone=running]{color:var(--warn);border-color:#66552c}.status[data-tone=success]{color:var(--accent);border-color:#286943}.status[data-tone=error]{color:var(--error);border-color:#783b37;border-radius:10px}
    .tabs{display:flex;gap:4px;margin:24px 0 14px;padding:4px;border:1px solid var(--line);border-radius:12px;background:#0b1512;width:max-content}
    .tab{min-width:120px;height:40px;border:0;border-radius:8px;background:transparent;color:var(--muted);cursor:pointer;font-weight:750}
    .tab.active{background:var(--panel2);color:var(--text);box-shadow:0 1px 8px #0004}
    .panel{border:1px solid var(--line);border-radius:16px;background:linear-gradient(145deg,rgba(20,34,30,.97),rgba(12,22,19,.97));box-shadow:0 18px 55px #0003}
    .run-card{display:grid;grid-template-columns:220px 180px 1fr auto;gap:16px;align-items:end;padding:20px}
    label{display:grid;gap:6px;color:var(--muted);font-size:12px;font-weight:700}
    select{height:42px;width:100%;padding:0 11px;border:1px solid var(--line);border-radius:9px;background:#091310;color:var(--text)}
    button.primary{height:42px;padding:0 18px;border:1px solid #52bd80;border-radius:9px;background:var(--accent);color:#052316;cursor:pointer;font-weight:800}
    button.primary:hover{background:#a9f2c7}button:disabled{cursor:wait;opacity:.55}
    button.secondary{height:34px;padding:0 11px;border:1px solid var(--line);border-radius:8px;background:var(--panel2);color:var(--text);cursor:pointer;font-weight:750}
    button.secondary:hover{border-color:#4b6c60}button.secondary:disabled{cursor:not-allowed;color:var(--muted)}
    .run-copy{align-self:center}.run-copy strong{display:block;font-size:15px}.run-copy span{display:block;color:var(--muted);font-size:12px;margin-top:2px}
    .progress-card{margin-top:12px;padding:16px 18px}
    .progress-copy{display:flex;justify-content:space-between;gap:15px;margin-bottom:9px}.progress-copy strong{font-size:13px}.progress-copy span{color:var(--muted);font-size:12px}
    .track{height:8px;overflow:hidden;border-radius:999px;background:#07100d}.bar{width:0;height:100%;border-radius:inherit;background:linear-gradient(90deg,#3dbb73,var(--accent));transition:width .18s ease}
    .preview{overflow:hidden;margin-top:12px}.panel-head{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--line)}
    .panel-head h2{margin:0;font-size:14px}.panel-head p{margin:2px 0 0;color:var(--muted);font-size:12px}
    .head-actions{display:flex;align-items:center;gap:12px}
    iframe{display:block;width:100%;height:650px;border:0;background:#f5f6f8}
    .filters{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;padding:16px}
    .summaries{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:12px 0}
    .summary{padding:15px 17px}.summary span{display:block;color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.summary strong{display:block;margin-top:4px;font-size:18px}
    .results-panel{overflow:hidden}.table-wrap{overflow:auto;max-height:640px}
    table{width:100%;border-collapse:collapse;font-size:13px}th{position:sticky;top:0;z-index:1;background:#101c18;color:var(--muted);font-size:10px;letter-spacing:.07em;text-align:left;text-transform:uppercase}
    th,td{padding:11px 13px;border-bottom:1px solid var(--line);white-space:nowrap}.framework-cell{font-weight:780}.number-cell{font-variant-numeric:tabular-nums}.rank-cell{color:var(--muted)}
    td.winner{color:var(--accent);font-weight:800;background:#173326}tbody tr:hover{background:#86e8b108}
    .empty{margin:0;padding:34px;color:var(--muted);text-align:center}
    .result-note{margin:12px 2px 0;color:var(--muted);font-size:12px}.result-note a{color:var(--accent)}
    @media(max-width:900px){.masthead{display:block}.status{display:inline-block}.run-card{grid-template-columns:1fr 1fr}.run-copy,.run-card .primary{grid-column:1/-1}.filters{grid-template-columns:repeat(2,1fr)}.summaries{grid-template-columns:1fr}.preview iframe{height:580px}}
    @media(max-width:560px){.page{width:calc(100% - 20px);padding-top:18px}.run-card,.filters{grid-template-columns:1fr}.run-copy,.run-card .primary{grid-column:auto}.tabs{width:100%}.tab{flex:1}.progress-copy{display:block}.progress-copy span{display:block;margin-top:3px}}
  </style>
</head>
<body>
  <main class="page">
    <header class="masthead">
      <div>
        <p class="eyebrow">Application benchmark</p>
        <h1>Run everything. Compare clearly.</h1>
        <p class="lede">One complete run measures every framework across every scenario and validates the resulting DOM.</p>
      </div>
      <div class="status" id="status" data-tone="running">Starting…</div>
    </header>

    <nav class="tabs" role="tablist" aria-label="Benchmark views">
      <button class="tab active" data-tab="run" role="tab" aria-selected="true">Run benchmark</button>
      <button class="tab" data-tab="results" role="tab" aria-selected="false">View results</button>
    </nav>

    <section data-panel="run">
      <article class="panel run-card">
        <label>Ticket count
          <select id="run-count"><option value="100">100 tickets</option><option value="1000" selected>1,000 tickets</option></select>
        </label>
        <label>Samples per workflow
          <select id="run-samples"><option value="1">1 — quick check</option><option value="3" selected>3 — recommended</option><option value="7">7 — stable median</option></select>
        </label>
        <div class="run-copy"><strong>7 frameworks × 7 scenarios</strong><span>Normal production event paths · independent DOM validation</span></div>
        <button class="primary" id="run-all">Run all frameworks and scenarios</button>
      </article>

      <article class="panel progress-card">
        <div class="progress-copy"><strong id="progress-text">0 of 49 workflows</strong><span id="current-run">Preparing memoized-dom preview…</span></div>
        <div class="track"><div class="bar" id="progress-bar"></div></div>
      </article>

      <article class="panel preview">
        <div class="panel-head"><div><h2>Current rendered application</h2><p>The iframe shows the workflow currently being measured.</p></div></div>
        <iframe id="preview-frame" title="Current benchmark application"></iframe>
      </article>
    </section>

    <section data-panel="results" hidden>
      <article class="panel filters" aria-label="Result filters">
        <label>Result source
          <select id="filter-source"><option value="recorded">Recorded isolated run</option><option value="live">This browser session</option></select>
        </label>
        <label>Ticket count<select id="filter-count"></select></label>
        <label>Metric
          <select id="filter-metric"><option value="time">Median time</option><option value="heap">Heap delta</option><option value="mutations">DOM mutation records</option></select>
        </label>
        <label>Framework
          <select id="filter-framework"><option value="all">All frameworks</option></select>
        </label>
        <label>Scenario
          <select id="filter-scenario"><option value="all">All scenarios</option></select>
        </label>
      </article>

      <div class="summaries">
        <article class="panel summary"><span>Best visible result</span><strong id="summary-best">—</strong></article>
        <article class="panel summary"><span>Source</span><strong id="summary-source">Recorded isolated run</strong></article>
        <article class="panel summary"><span>Scope</span><strong id="summary-scope">—</strong></article>
      </div>

      <article class="panel results-panel">
        <div class="panel-head"><div><h2 id="result-title">Median time comparison</h2><p id="result-description">Lower is better.</p></div><div class="head-actions"><p id="recorded-meta">Loading latest results…</p><button class="secondary" id="export-live" disabled>Export live JSON</button></div></div>
        <div class="table-wrap">
          <table><thead id="result-head"></thead><tbody id="result-body"></tbody></table>
          <p class="empty" id="result-empty" hidden>No results match these filters.</p>
        </div>
      </article>
      <p class="result-note">Live browser results are exploratory because adapters share this process. The persisted runner uses fresh Chromium processes. <a href="./latest.json" target="_blank">Open complete JSON</a>.</p>
    </section>
  </main>
  <script src="./dashboard.js"></script>
</body>
</html>
`;
