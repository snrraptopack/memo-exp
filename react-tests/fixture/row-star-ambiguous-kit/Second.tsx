import { Children } from 'react';

export function CapturedRows({ children }: { children: unknown }) {
  return <ol>{Children.map(children, child => <li>{child}</li>)}</ol>;
}
