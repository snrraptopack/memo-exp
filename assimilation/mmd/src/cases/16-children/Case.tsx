function ListGroup({ title, children }: { title: string; children?: unknown }) {
  return (
    <section>
      <h3>{title}</h3>
      <ul>{children}</ul>
    </section>
  );
}

function WrappedList({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h3>
        {title} <output data-testid="count-wrapped">({items.length})</output>
      </h3>
      <ul>
        {items.map((item, i) => (
          <li data-index={i}>{item}</li>
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
      <WrappedList title="wrapped" items={['A', 'B']} />
    </>
  );
}
