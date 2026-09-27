import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { UseStateCounter } from './cases/01-usestate-counter/Case';
import { UseEffectTitle } from './cases/02-useeffect-title/Case';
import { MemoForwardRef } from './cases/03-memo-forwardref/Case';
import { MemoOnly } from './cases/04-memo-only/Case';

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
      </Routes>
    </main>
  );
}
