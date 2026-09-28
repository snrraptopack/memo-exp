import { Link, Route, Routes, useLocation } from 'react-router-dom';
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
import { FormsCase } from './cases/20-forms/Case';
import { CreatePortalCase } from './cases/21-createportal/Case';
import { SuspenseCase } from './cases/22-suspense/Case';

function Chrome() {
  const { pathname } = useLocation();
  return (
    <header>
      <strong>React reference</strong>
      {' — MMD twin: '}
      <a href={`http://localhost:5174${pathname}`}>
        localhost:5174{pathname}
      </a>
      {' · '}
      <Link to="/">all cases</Link>
    </header>
  );
}

function CaseIndex() {
  return (
    <nav>
      <h1>Cases</h1>
      <ul>
        <li>
          <Link to="/01-usestate-counter">
            useState — counter with derived value
          </Link>
        </li>
        <li>
          <Link to="/02-useeffect-title">
            useEffect — syncing document.title
          </Link>
        </li>
        <li>
          <Link to="/03-memo-forwardref">
            memo + forwardRef — wrappers and ref props
          </Link>
        </li>
        <li>
          <Link to="/04-memo-only">memo — erased wrapper, plain component</Link>
        </li>
        <li>
          <Link to="/05-usememo">useMemo — derived chains</Link>
        </li>
        <li>
          <Link to="/06-usecallback">useCallback — dep-driven closure</Link>
        </li>
        <li>
          <Link to="/07-usereducer">useReducer — with initializer</Link>
        </li>
        <li>
          <Link to="/08-usesyncexternalstore">
            useSyncExternalStore — external store
          </Link>
        </li>
        <li>
          <Link to="/09-uselayouteffect">
            useLayoutEffect — measure before paint
          </Link>
        </li>
        <li>
          <Link to="/10-useimperativehandle">
            useImperativeHandle — parent-driven actions
          </Link>
        </li>
        <li>
          <Link to="/11-usecontext">useContext — provider through layers</Link>
        </li>
        <li>
          <Link to="/12-useid">useId — stable unique ids</Link>
        </li>
        <li>
          <Link to="/13-usetransition">useTransition — deferred list update</Link>
        </li>
        <li>
          <Link to="/14-usedeferredvalue">useDeferredValue — lagging mirror</Link>
        </li>
        <li>
          <Link to="/15-fragment">Fragment — children without a wrapper</Link>
        </li>
        <li>
          <Link to="/16-children">Children — count + map</Link>
        </li>
        <li>
          <Link to="/17-attrs">attrs — className / style / for / onChange</Link>
        </li>
        <li>
          <Link to="/18-usedebugvalue">useDebugValue — devtools label only</Link>
        </li>
        <li>
          <Link to="/19-useinsertioneffect">
            useInsertionEffect — styles before layout
          </Link>
        </li>
        <li>
          <Link to="/20-forms">React 19 forms — action state + optimistic</Link>
        </li>
        <li>
          <Link to="/21-createportal">createPortal — render outside the root</Link>
        </li>
        <li>
          <Link to="/22-suspense">Suspense + lazy vs Group/suspend + $read</Link>
        </li>
      </ul>
    </nav>
  );
}

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 640, margin: '2rem auto' }}>
      <Chrome />
      <hr />
      <Routes>
        <Route path="/" element={<CaseIndex />} />
        <Route path="/01-usestate-counter" element={<UseStateCounter />} />
        <Route path="/02-useeffect-title" element={<UseEffectTitle />} />
        <Route path="/03-memo-forwardref" element={<MemoForwardRef />} />
        <Route path="/04-memo-only" element={<MemoOnly />} />
        <Route path="/05-usememo" element={<UseMemoDerived />} />
        <Route path="/06-usecallback" element={<UseCallbackStep />} />
        <Route path="/07-usereducer" element={<UseReducerInit />} />
        <Route path="/08-usesyncexternalstore" element={<UseSyncExternalStoreCase />} />
        <Route path="/09-uselayouteffect" element={<UseLayoutEffectMeasure />} />
        <Route path="/10-useimperativehandle" element={<UseImperativeHandleCase />} />
        <Route path="/11-usecontext" element={<UseContextCase />} />
        <Route path="/12-useid" element={<UseIdCase />} />
        <Route path="/13-usetransition" element={<UseTransitionCase />} />
        <Route path="/14-usedeferredvalue" element={<UseDeferredValueCase />} />
        <Route path="/15-fragment" element={<FragmentCase />} />
        <Route path="/16-children" element={<ChildrenCase />} />
        <Route path="/17-attrs" element={<AttrsCase />} />
        <Route path="/18-usedebugvalue" element={<UseDebugValueCase />} />
        <Route path="/19-useinsertioneffect" element={<UseInsertionEffectCase />} />
        <Route path="/20-forms" element={<FormsCase />} />
        <Route path="/21-createportal" element={<CreatePortalCase />} />
        <Route path="/22-suspense" element={<SuspenseCase />} />
      </Routes>
    </main>
  );
}
