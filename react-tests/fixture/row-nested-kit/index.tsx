import { Children, useState } from 'react';

function Marker({ tone }: { tone: string }) {
  const [hits, setHits] = useState(0);
  return <button className={tone} onClick={() => setHits(previous => previous + 1)}>{hits}</button>;
}

export function NestedRows({ children, className }: { children: unknown; className: string }) {
  const [active, setActive] = useState(false);
  const applied = active ? 'active' : className;
  return <div>
    <button id="package-toggle" onClick={() => setActive(previous => !previous)}>active</button>
    <ul>{Children.map(children, child =>
      <li className={applied}><Marker tone={applied} />{child}</li>)}</ul>
  </div>;
}
