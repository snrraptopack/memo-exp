import { useLayoutEffect, useRef, useState } from 'react';

export function UseLayoutEffectMeasure() {
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    setWidth(box.current?.getBoundingClientRect().width ?? 0);
  }, []);

  return (
    <section>
      <h2>useLayoutEffect — measure before paint</h2>
      <div
        ref={box}
        style={{ width: '120px', background: '#dde', padding: '4px' }}
      >
        measured box
      </div>
      <p>
        measured width: <span data-testid="width">{width}</span>
      </p>
      <p>
        <small>
          React: the measured width appears in the first painted frame — a
          post-paint effect would flash 0 first.
        </small>
      </p>
    </section>
  );
}
