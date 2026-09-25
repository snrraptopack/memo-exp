import { useState as state, useMemo, useCallback, useEffect } from 'react';

export function Counter({ label }: { label: string }) {
  const [count, setCount] = state(() => 1);
  const doubled = useMemo(() => count * 2, [count]);
  const advance = useCallback(() => setCount(previous => previous + 1), []);
  useEffect(() => {
    document.title = label + ':' + doubled;
    return () => { document.body.dataset.cleaned = label + ':' + doubled; };
  }, [doubled]);
  return <button onClick={advance}>{label}:{doubled}</button>;
}
