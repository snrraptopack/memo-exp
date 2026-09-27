import { Children } from 'react';
import type { ReactNode } from 'react';

function ListGroup({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section>
      <h3>
        {title} <output data-testid={`count-${title}`}>({Children.count(children)})</output>
      </h3>
      <ul>
        {Children.map(children, (child, i) => (
          <li key={i} data-index={i}>
            {child}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ChildrenCase() {
  return (
    <>
      <h2>Children — count + map</h2>
      <ListGroup title="two">
        <span>A</span>
        <span>B</span>
      </ListGroup>
      <ListGroup title="none" />
      <ListGroup title="fragment">
        <>
          <span>C</span>
          <span>D</span>
        </>
      </ListGroup>
    </>
  );
}
