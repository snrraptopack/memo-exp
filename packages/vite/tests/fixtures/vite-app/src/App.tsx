/**
 * Authored graph entry for Vite adapter integration.
 */
import { increment } from '@/state';
import { Label } from './Label';

export function App() {
  return (
    <main>
      <button onClick={increment}>Increment</button>
      <Label />
    </main>
  );
}
