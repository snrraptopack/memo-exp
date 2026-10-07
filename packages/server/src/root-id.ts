import { rootFactoryStore } from '@memoized-dom/runtime/server';

/** A compiled application root factory: `function App(_id, _parent)`. */
export type ServerComponent = (id: string, parent: null) => Node;

/**
 * The hydration root id stamped into markers and the payload channel must match
 * the client-side root factory id, which the compiler derives from the mount
 * callee (`mount('root', Main)` → `'Main'`). Registered factories record that
 * id at module evaluation. Server rendering requires that registration.
 */
export function serverRootId(component: ServerComponent): string {
  const root = rootFactoryStore().get(component);
  if (!root) {
    throw new Error('memoized-dom: server render received a component that is not a compiled application root');
  }
  return root.id;
}
