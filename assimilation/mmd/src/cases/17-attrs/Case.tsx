export function AttrsCase() {
  let enabled = false;
  let checked = true;
  let text = '';
  return (
    <section>
      <h2>attrs — className / style / htmlFor / checked / onInput</h2>
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
      <div style="padding: 8px; outline: 1px dashed #999">
        style string — also valid in authored MMD
      </div>
      <p>
        <label htmlFor="field-x">htmlFor → for</label>{' '}
        <input id="field-x" placeholder="click the label" />
      </p>
      <p>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => (checked = e.currentTarget.checked)}
        />{' '}
        checked (DOM property, not attribute)
      </p>
      <p>
        <input
          value={text}
          placeholder="controlled — onInput per keystroke"
          onInput={(e) => (text = e.currentTarget.value)}
        />{' '}
        <output data-testid="echo">{text}</output>
      </p>
      <button disabled={!enabled}>disabled={'{!enabled}'}</button>{' '}
      <button onClick={() => (enabled = !enabled)}>toggle enabled</button>
    </section>
  );
}
