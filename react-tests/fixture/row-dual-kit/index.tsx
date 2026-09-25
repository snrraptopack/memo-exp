import { Children } from 'react';

export function DualRows({ children }: { children: unknown }) {
  return <main>
    <div>{children}</div>
    <ul>{Children.map(children, child => <li>{child}</li>)}</ul>
  </main>;
}
