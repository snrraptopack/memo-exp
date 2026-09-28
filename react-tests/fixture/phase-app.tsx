import { StrictMode, useDebugValue, useRef, useState } from 'react';
import { Trace, Field, Pair, Deferred, CreatedRef } from 'phase-kit';

interface FieldApi {
  read(): string;
  clear(): void;
}

// useDebugValue erases in any statement position — including inside a plain
// helper that is not a component.
function decorate(label: string): string {
  useDebugValue(label);
  return label.toUpperCase();
}

export function App() {
  const api = useRef<FieldApi | null>(null);
  const cbApi = useRef<FieldApi | null>(null);
  const [seen, setSeen] = useState('unread');
  const [shown, setShown] = useState(true);
  const [cbShown, setCbShown] = useState(true);
  const [cbState, setCbState] = useState('none');
  const title = decorate('title');
  return <StrictMode>
    <main title={title}>
      <Trace />
      {shown ? <Pair /> : null}
      <Field label="ctl" ref={api} />
      {cbShown ? <Field label="cb" ref={(handle: FieldApi | null) => {
        cbApi.current = handle;
        return () => { cbApi.current = null; setCbState('detached'); };
      }} /> : null}
      <button id="read" onClick={() => setSeen(api.current?.read() ?? 'none')}>read</button>
      <button id="clear" onClick={() => { api.current?.clear(); setSeen('cleared'); }}>clear</button>
      <button id="gone" onClick={() => setShown(false)}>gone</button>
      <button id="cbread" onClick={() => setCbState(cbApi.current?.read() ?? 'none')}>cbread</button>
      <button id="cbgone" onClick={() => setCbShown(false)}>cbgone</button>
      <output id="seen">{seen}</output>
      <output id="cbstate">{cbState}</output>
      <Deferred />
      <CreatedRef />
    </main>
  </StrictMode>;
}
