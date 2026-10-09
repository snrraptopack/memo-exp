/** Region selection never publishes or retires its accepted child while staging. */
import type { SceneRegionBinding } from './application';
import { propValues } from './values';

export function readRegion(binding: SceneRegionBinding) {
  const selected = binding.read();
  if (!selected || !Number.isInteger(selected.branch) || selected.branch < 0 || selected.branch >= binding.branches.length) throw new Error('Invalid desktop region branch');
  const component = binding.branches[selected.branch];
  if (component !== null && typeof component !== 'function') throw new Error('Invalid desktop region component');
  return { branch: selected.branch, component, props: component ? propValues(selected.props) : {} };
}
export function stagedReadiness() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, fail) => { resolve=accept; reject=fail; });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
