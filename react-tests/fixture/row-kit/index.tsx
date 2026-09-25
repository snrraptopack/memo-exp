import { Children } from 'react';

export function RowList({ children }: { children: unknown }) {
  return <section>
    <output>{Children.count(children)}</output>
    <ul>{Children.map(children, (child, index) => {
      return <li className="row" data-index={index}>{child}</li>;
    })}</ul>
  </section>;
}
