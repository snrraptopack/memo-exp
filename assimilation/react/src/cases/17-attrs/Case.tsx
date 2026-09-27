import { useId, useState } from 'react';

export function AttrsCase() {
  const [enabled, setEnabled] = useState(false);
  const [checked, setChecked] = useState(true);
  const [text, setText] = useState('');
  const id = useId();
  return (
    <section>
      <h2>attrs — className / style / htmlFor / checked / onChange</h2>
      <p
        className={enabled ? 'state-on' : 'state-off'}
        data-state={enabled ? 'on' : 'off'}
        aria-live="polite"
      >
        className + data-* + aria-* — check DOM
      </p>
      <div
        style={{
          padding: '8px',
          marginBottom: '4px',
          background: enabled ? '#cde' : '#eee',
          borderWidth: 2,
          borderStyle: 'solid',
        }}
      >
        style object — camelCase props, numeric borderWidth
      </div>
      <p>
        <label htmlFor={id}>htmlFor → for</label>{' '}
        <input id={id} placeholder="click the label" />
      </p>
      <p>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />{' '}
        checked (DOM property, not attribute)
      </p>
      <p>
        <input
          value={text}
          placeholder="controlled — onChange per keystroke"
          onChange={(e) => setText(e.target.value)}
        />{' '}
        <output data-testid="echo">{text}</output>
      </p>
      <button disabled={!enabled}>disabled={'{!enabled}'}</button>{' '}
      <button onClick={() => setEnabled((e) => !e)}>toggle enabled</button>
    </section>
  );
}
