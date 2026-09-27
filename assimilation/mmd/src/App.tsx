import { route } from '@memoized-dom/router';
import { UseStateCounter } from './cases/01-usestate-counter/Case';
import { UseEffectTitle } from './cases/02-useeffect-title/Case';
import { MemoForwardRef } from './cases/03-memo-forwardref/Case';
import { MemoOnly } from './cases/04-memo-only/Case';
import { UseMemoDerived } from './cases/05-usememo/Case';
import { UseCallbackStep } from './cases/06-usecallback/Case';
import { UseReducerInit } from './cases/07-usereducer/Case';
import { UseSyncExternalStoreCase } from './cases/08-usesyncexternalstore/Case';
import { UseLayoutEffectMeasure } from './cases/09-uselayouteffect/Case';

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
        <li>
          <a route-to="/05-usememo">useMemo — derived chains</a>
        </li>
        <li>
          <a route-to="/06-usecallback">useCallback — dep-driven closure</a>
        </li>
        <li>
          <a route-to="/07-usereducer">useReducer — with initializer</a>
        </li>
        <li>
          <a route-to="/08-usesyncexternalstore">
            useSyncExternalStore — external store
          </a>
        </li>
        <li>
          <a route-to="/09-uselayouteffect">
            useLayoutEffect — measure before paint
          </a>
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
      <UseMemoDerived route="/05-usememo" />
      <UseCallbackStep route="/06-usecallback" />
      <UseReducerInit route="/07-usereducer" />
      <UseSyncExternalStoreCase route="/08-usesyncexternalstore" />
      <UseLayoutEffectMeasure route="/09-uselayouteffect" />
    </main>
  );
}
