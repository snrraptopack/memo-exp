/** Validate all row keys and primitive props before allocating any candidate. */
import type { SceneListBinding, SceneRowKey } from './application';
import { propValues } from './values';

export function readList(binding: SceneListBinding) {
  const values = binding.read();
  if (!Array.isArray(values)) throw new Error('Desktop list reader must return an array');
  const seen = new Set<SceneRowKey>();
  return Array.from(values, value => {
    if (!value || (typeof value.key !== 'string' && (typeof value.key !== 'number' || !Number.isFinite(value.key)))) throw new Error('Desktop row keys require strings or finite numbers');
    if (seen.has(value.key)) throw new Error('Duplicate desktop row key');
    seen.add(value.key);
    return { key: value.key, props: propValues(value.props) };
  });
}
