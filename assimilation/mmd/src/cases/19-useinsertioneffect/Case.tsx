export function UseInsertionEffectCase() {
  let marker: HTMLSpanElement | undefined;
  let styledAtMeasure = false;

  effect(() => {
    const style = document.createElement('style');
    style.textContent = '.inserted { color: #0a7; font-weight: 600; }';
    document.head.appendChild(style);
    marker?.classList.add('inserted');
    styledAtMeasure =
      marker !== undefined &&
      getComputedStyle(marker).fontWeight === '600';
    return () => {
      style.remove();
      marker?.classList.remove('inserted');
    };
  });

  return (
    <section>
      <h2>useInsertionEffect — styles before layout</h2>
      <p>
        styled during first effect:{' '}
        <span data-testid="styled">{String(styledAtMeasure)}</span>
      </p>
      <span className="inserted" ref={marker}>
        marker text — should be green+bold
      </span>
      <p>
        <small>
          MMD has one ordered effect phase — registration order is the
          ordering; if it lands pre-paint, insertion semantics hold.
        </small>
      </p>
    </section>
  );
}
