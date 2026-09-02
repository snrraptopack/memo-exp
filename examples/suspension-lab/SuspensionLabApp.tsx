import { LabRoutes } from './routes/LabRoutes';

export function SuspensionLabApp() {
  return (
    <div class="lab-shell">
      <header class="lab-header">
        <a class="brand" route-to="/">
          <span class="brand-mark">M</span>
          <span><strong>Suspension Lab</strong><small>Memoized DOM · ESTree</small></span>
        </a>
        <nav aria-label="Experiments">
          <a route-to="/colorless-tsx">TSX colorless</a>
          <a route-to="/suspended-tsx">TSX suspend</a>
          <a route-to="/suspended-tsrx">TSRX suspend</a>
          <a route-to="/colorless-tsrx">TSRX retry</a>
        </nav>
        <button class="restart-button" onClick={() => window.location.reload()}>Restart timing</button>
      </header>
      <LabRoutes />
      <footer class="lab-footer">
        <span>Three independent Fetch-compatible requests</span>
        <span>Yuku TSX + @tsrx/core → shared ESTree compiler</span>
      </footer>
    </div>
  );
}
