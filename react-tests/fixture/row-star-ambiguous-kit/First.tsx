import { Children } from 'react';

export function CapturedRows({ children }: { children: unknown }) {
  return <ul>{Children.map(children, child => <li>{child}</li>)}</ul>;
}
