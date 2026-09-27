import { Group } from '@memoized-dom/data';
import { InlinePending, Failure } from './components/Feedback';
import { DemoRoutes } from './pages/DemoRoutes';

export function App() {
  return <div class="app-shell">
    <header>
      <a class="brand" route-to="/">Group + Router Lab</a>
      <nav aria-label="Reveal experiments">
        <a route-to={{ path: '/progressive/:run', params: { run: 'first' } }}>Progressive rows</a>
        <a route-to={{ path: '/atomic/:run', params: { run: 'first' } }}>Atomic board</a>
        <a route-to={{ path: '/detail/:id', params: { id: 'fast' } }}>Fast detail (400ms)</a>
        <a route-to={{ path: '/detail/:id', params: { id: 'slow' } }}>Slow detail (2400ms)</a>
      </nav>
      <nav class="fresh-runs" aria-label="Fresh request identities">
        <a route-to={{ path: '/progressive/:run', params: { run: 'second' } }}>Fresh progressive run</a>
        <a route-to={{ path: '/atomic/:run', params: { run: 'second' } }}>Fresh atomic run</a>
      </nav>
    </header>
    <Group pending={InlinePending} error={Failure}><DemoRoutes route="/" /></Group>
    <footer>800ms / 1500ms / 2800ms demo responses. No remote service. Header stays mounted across routes.</footer>
  </div>;
}
