/** Validate all row keys and props before allocating any candidate. */
import type { SceneListBinding, SceneRenderListBinding, SceneRowKey } from './application';
import { propValues } from './values';
import { contentDefinition } from './content';

export function readList(
  binding: SceneListBinding | SceneRenderListBinding,
  readProps = propValues,
) {
  const definition = 'render' in binding ? contentDefinition(binding.render(), 'rows') : undefined;
  const supplied = binding.read();
  if (!Array.isArray(supplied)) throw new Error('Desktop list reader must return an array');
  const values = definition
    ? (supplied as ReturnType<SceneRenderListBinding['read']>).map((args) => {
        if (!Array.isArray(args))
          throw new TypeError('Desktop render callback arguments require an array');
        return definition.read(...args);
      })
    : (supplied as ReturnType<SceneListBinding['read']>);
  const seen = new Set<SceneRowKey>();
  return Array.from(values, (value) => {
    if (
      !value ||
      (typeof value.key !== 'string' &&
        (typeof value.key !== 'number' || !Number.isFinite(value.key)))
    )
      throw new Error('Desktop row keys require strings or finite numbers');
    if (seen.has(value.key)) throw new Error('Duplicate desktop row key');
    seen.add(value.key);
    return {
      key: value.key,
      props: readProps(value.props),
      component: definition?.component ?? (binding as SceneListBinding).component,
      lexicalOwner: definition?.owner,
    };
  });
}
