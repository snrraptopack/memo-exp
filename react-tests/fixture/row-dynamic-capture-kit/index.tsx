import { Children, useState } from 'react';

export function CapturedList({ children, className }: { children: unknown; className: string }) {
  const [active, setActive] = useState(false);
  const applied = active ? 'active' : className;
  return <div>
    <button id="package-toggle" onClick={() => setActive(previous => !previous)}>active</button>
    <ul>{Children.map(children, child => <li className={applied}>{child}</li>)}</ul>
  </div>;
}
