import { Group } from 'compound-kit';

export function App() {
  return <main>
    <Group><span>A</span><span>B</span></Group>
    <Group />
    <Group><><span>C</span><span>D</span></></Group>
    <Group>{null}</Group>
  </main>;
}
