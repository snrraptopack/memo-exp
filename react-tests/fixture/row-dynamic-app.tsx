import { RowList } from 'row-kit';

export function App({ child }: { child: unknown }) {
  return <RowList>{child}</RowList>;
}
