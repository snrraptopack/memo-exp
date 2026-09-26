import { forwardRef, memo, useState } from 'react';

export const FancyInput = memo(forwardRef(function FancyInput(
  { label }: { label: string }, forwardedRef: unknown,
) {
  const [clicks, setClicks] = useState(0);
  return <label>
    <span>{label}</span>
    <input ref={forwardedRef} />
    <button className="inside" onClick={() => setClicks(previous => previous + 1)}>{clicks}</button>
  </label>;
}));

export const Badge = memo(({ label }: { label: string }) => <strong>{label}</strong>);
