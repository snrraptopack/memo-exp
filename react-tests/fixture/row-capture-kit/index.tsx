import { Children } from 'react';

export function CapturedRows({ children, className }: { children: unknown; className: string }) {
  return <ul>{Children.map(children, child => <li className={className}>{child}</li>)}</ul>;
}
