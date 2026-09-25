import { Children } from 'react';

export function Group({ children }: { children: unknown }) {
  return <section><output>{Children.count(children)}</output><div>{children}</div></section>;
}
