/**
 * Linked child component for Vite adapter integration.
 */
import { count } from '@/state';

export function Label() {
  return <output>{count}</output>;
}
