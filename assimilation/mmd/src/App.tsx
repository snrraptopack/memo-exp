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
import { UseImperativeHandleCase } from './cases/10-useimperativehandle/Case';
import { UseContextCase } from './cases/11-usecontext/Case';
import { UseIdCase } from './cases/12-useid/Case';
import { UseTransitionCase } from './cases/13-usetransition/Case';
import { UseDeferredValueCase } from './cases/14-usedeferredvalue/Case';
import { FragmentCase } from './cases/15-fragment/Case';
import { ChildrenCase } from './cases/16-children/Case';
import { AttrsCase } from './cases/17-attrs/Case';
import { UseDebugValueCase } from './cases/18-usedebugvalue/Case';
import { UseInsertionEffectCase } from './cases/19-useinsertioneffect/Case';

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
        <li>
          <a route-to="/10-useimperativehandle">
            useImperativeHandle — parent-driven actions
          </a>
        </li>
        <li>
          <a route-to="/11-usecontext">useContext — provider through layers</a>
        </li>
        <li>
          <a route-to="/12-useid">useId — stable unique ids</a>
        </li>
        <li>
          <a route-to="/13-usetransition">useTransition — deferred list update</a>
        </li>
        <li>
          <a route-to="/14-usedeferredvalue">useDeferredValue — lagging mirror</a>
        </li>
        <li>
          <a route-to="/15-fragment">Fragment — children without a wrapper</a>
        </li>
        <li>
          <a route-to="/16-children">Children — count + map</a>
        </li>
        <li>
          <a route-to="/17-attrs">attrs — className / style / for / onChange</a>
        </li>
        <li>
          <a route-to="/18-usedebugvalue">useDebugValue — devtools label only</a>
        </li>
        <li>
          <a route-to="/19-useinsertioneffect">
            useInsertionEffect — styles before layout
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
      <UseImperativeHandleCase route="/10-useimperativehandle" />
      <UseContextCase route="/11-usecontext" />
      <UseIdCase route="/12-useid" />
      <UseTransitionCase route="/13-usetransition" />
      <UseDeferredValueCase route="/14-usedeferredvalue" />
      <FragmentCase route="/15-fragment" />
      <ChildrenCase route="/16-children" />
      <AttrsCase route="/17-attrs" />
      <UseDebugValueCase route="/18-usedebugvalue" />
      <UseInsertionEffectCase route="/19-useinsertioneffect" />
    </main>
  );
}
