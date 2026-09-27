function Pair({ term, def }: { term: string; def: string }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{def}</dd>
    </>
  );
}

export function FragmentCase() {
  return (
    <section>
      <h2>Fragment — children without a wrapper</h2>
      <dl>
        <Pair term="alpha" def="first letter" />
        <Pair term="beta" def="second letter" />
      </dl>
      <p>
        <small>
          Inspect the DOM: the &lt;dl&gt;'s direct children are dt/dd only —
          a wrapper element would be invalid HTML here.
        </small>
      </p>
    </section>
  );
}
