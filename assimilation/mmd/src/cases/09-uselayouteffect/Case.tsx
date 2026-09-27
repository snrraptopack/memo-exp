export function UseLayoutEffectMeasure() {
  let box: HTMLDivElement | undefined;
  let width = 0;

  effect(() => {
    width = box?.getBoundingClientRect().width ?? 0;
  });

  return (
    <section>
      <h2>useLayoutEffect — measure before paint</h2>
      <div
        ref={box}
        style="width: 120px; background: #dde; padding: 4px"
      >
        measured box
      </div>
      <p>
        measured width: <span data-testid="width">{width}</span>
      </p>
      <p>
        <small>
          MMD: effect runs in the post-render phase — if it lands before
          paint, width shows 120 immediately with no 0-flash.
        </small>
      </p>
    </section>
  );
}
