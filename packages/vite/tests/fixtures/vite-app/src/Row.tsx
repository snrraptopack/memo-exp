/**
 * Keyed row that mutates a globally observable collection received as a prop.
 */
export function Row(props: {
  item: number;
  selected: Set<number>;
}) {
  const active = props.selected.has(props.item);
  return (
    <li onClick={() => props.selected.add(props.item)}>
      {active ? 'selected' : 'idle'}
    </li>
  );
}
