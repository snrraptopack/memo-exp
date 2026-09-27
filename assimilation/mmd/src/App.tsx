import { route } from '@memoized-dom/router';
import { UseStateCounter } from './cases/01-usestate-counter/Case';
import { UseEffectTitle } from './cases/02-useeffect-title/Case';
import { MemoForwardRef } from './cases/03-memo-forwardref/Case';
import { MemoOnly } from './cases/04-memo-only/Case';

function Chrome() {
  return (
    <header>
      <strong>MMD twin</strong>
      {' — React reference: '}
      <a href={`http://localhost:5173${route.pathname}`}>
        localhost:5173{route.pathname}
      </a>
      {' · '}
      <a route-to="/">all cases</a>
    </header>
  );
}

function CaseIndex() {
  return (
    <nav>
      <h1>Cases</h1>
      <ul>
        <li>
          <a route-to="/01-usestate-counter">
            useState — counter with derived value
          </a>
        </li>
        <li>
          <a route-to="/02-useeffect-title">
            useEffect — syncing document.title
          </a>
        </li>
        <li>
          <a route-to="/03-memo-forwardref">
            memo + forwardRef — wrappers and ref props
          </a>
        </li>
        <li>
          <a route-to="/04-memo-only">memo — erased wrapper, plain component</a>
        </li>
      </ul>
    </nav>
  );
}

export function App() {
  return (
    <main style="font-family: system-ui; max-width: 640px; margin: 2rem auto">
      <Chrome />
      <hr />
      <CaseIndex route="/" />
      <UseStateCounter route="/01-usestate-counter" />
      <UseEffectTitle route="/02-useeffect-title" />
      <MemoForwardRef route="/03-memo-forwardref" />
      <MemoOnly route="/04-memo-only" />
    </main>
  );
}
