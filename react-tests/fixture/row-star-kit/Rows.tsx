import { Children, useState } from 'react';

function Row({ children, className }: { children: unknown; className: string }) {
  return <li className={className}>{children}</li>;
}

export function CapturedRows({ children, className }: { children: unknown; className: string }) {
  const [active, setActive] = useState(false);
  const applied = active ? 'active' : className;
  return <div>
    <button id="package-toggle" onClick={() => setActive(previous => !previous)}>active</button>
    <ul>{Children.map(children, child => <Row className={applied}>{child}</Row>)}</ul>
  </div>;
}
