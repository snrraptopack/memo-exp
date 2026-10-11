/** Region selection never publishes or retires its accepted child while staging. */
import type { SceneRegionBinding, SceneContentBinding } from './application';
import { propValues } from './values';
import { sceneScope } from './scope';
import { contentDefinition } from './content';

export function readRegion(
  binding: SceneRegionBinding | SceneContentBinding,
  readProps = propValues,
) {
  if ('content' in binding) {
    const content = binding.content();
    if (content == null || typeof content === 'boolean') {
      return { branch: 1, component: null, props: {}, lexicalOwner: undefined };
    }
    if (binding.scalar && ['string', 'number', 'bigint'].includes(typeof content)) {
      return {
        branch: 0,
        component: binding.scalar,
        props: readProps({ scope: sceneScope(content) }),
        lexicalOwner: undefined,
      };
    }
    const definition = contentDefinition(content, 'content');
    return {
      branch: 0,
      component: definition.component,
      props: readProps(definition.read()),
      lexicalOwner: definition.owner,
    };
  }
  const selected = binding.read();
  if (
    !selected ||
    !Number.isInteger(selected.branch) ||
    selected.branch < 0 ||
    selected.branch >= binding.branches.length
  )
    throw new Error('Invalid desktop region branch');
  const component = binding.branches[selected.branch];
  if (component !== null && typeof component !== 'function')
    throw new Error('Invalid desktop region component');
  return {
    branch: selected.branch,
    component,
    props: component ? readProps(selected.props) : {},
    lexicalOwner: undefined,
  };
}
export function stagedReadiness() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
