import { Group } from 'compound-kit';

export function App({ child }: { child: unknown }) {
  return <Group>{child}</Group>;
}
