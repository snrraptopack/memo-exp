/**
 * Static child that mutates shared state received through a forwarded prop.
 */
export function Panel(props: { selected: Set<number> }) {
  const { selected } = props;
  return (
    <button onClick={() => selected.clear()}>
      {selected.size}
    </button>
  );
}
