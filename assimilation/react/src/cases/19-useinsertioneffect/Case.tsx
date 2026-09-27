import { useInsertionEffect, useLayoutEffect, useRef, useState } from 'react';

export function UseInsertionEffectCase() {
  const marker = useRef<HTMLSpanElement | null>(null);
  const [styledAtMeasure, setStyledAtMeasure] = useState(false);

  useInsertionEffect(() => {
    const style = document.createElement('style');
    style.textContent = '.inserted { color: #0a7; font-weight: 600; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  useLayoutEffect(() => {
    setStyledAtMeasure(
      marker.current !== null &&
        getComputedStyle(marker.current).fontWeight === '600',
    );
  }, []);

  return (
    <section>
      <h2>useInsertionEffect — styles before layout</h2>
      <p>
        styled at layout-effect time:{' '}
        <span data-testid="styled">{String(styledAtMeasure)}</span>
      </p>
      <span className="inserted" ref={marker}>
        marker text — should be green+bold
      </span>
      <p>
        <small>
          React's insertion effect can't touch refs (they attach later) —
          measuring lives in the layout effect, which proves insertion ran
          first.
        </small>
      </p>
    </section>
  );
}
