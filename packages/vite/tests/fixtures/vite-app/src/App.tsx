/**
 * Authored graph entry for Vite adapter integration.
 */
import {
  increment,
  items,
  selected,
  selectedCount,
} from '@/state';
import { Forwarder } from './Forwarder';
import { Label } from './Label';
import { Row } from './Row';

export function App() {
  return (
    <main>
      <button onClick={increment}>Increment</button>
      <Label />
      <output>{selectedCount}</output>
      <Forwarder selected={selected} />
      <ul>
        {items.map((item) => (
          <Row key={item} item={item} selected={selected} />
        ))}
      </ul>
    </main>
  );
}
