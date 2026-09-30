/**
 * Propagates canonical prop origins through the acyclic component graph.
 */
import type {
  ComponentGraphNode,
} from '../component-linker';
import type {
  LinkedComponentPropSource,
} from '../context';
import type {
  ComponentPropSourceRef,
} from './prop-origins';

interface MutablePropSource {
  keys: Set<string>;
  rootFallback: boolean;
  transparent: boolean;
  publishedCallback: boolean;
}

function sourceFor(
  resolved: Map<string, Map<string, MutablePropSource>>,
  component: string,
  prop: string,
): MutablePropSource {
  let props = resolved.get(component);
  if (props === undefined) {
    props = new Map();
    resolved.set(component, props);
  }
  let source = props.get(prop);
  if (source === undefined) {
    source = { keys: new Set(), rootFallback: false, transparent: false, publishedCallback: true };
    props.set(prop, source);
  }
  return source;
}

function resolveRef(
  resolved: Map<string, Map<string, MutablePropSource>>,
  caller: string,
  ref: ComponentPropSourceRef,
  target: MutablePropSource,
): void {
  if (ref.type === 'published-callback') return;
  // Forward only a whole callback prop, never a property/getter of it.
  if (ref.type !== 'prop' || ref.path.length !== 0) target.publishedCallback = false;
  if (ref.type === 'state') {
    target.keys.add(ref.key);
    return;
  }
  if (ref.type === 'transparent') {
    target.transparent = true;
    return;
  }
  if (ref.type === 'root') {
    target.rootFallback = true;
    return;
  }
  if (ref.type === 'local') return;

  const callerSource = resolved.get(caller)?.get(ref.name);
  if (callerSource === undefined) {
    target.rootFallback = true;
    target.publishedCallback = false;
    return;
  }
  target.rootFallback ||= callerSource.rootFallback;
  target.publishedCallback &&= callerSource.publishedCallback;
  target.transparent ||= callerSource.transparent;
  const suffix = ref.path.length === 0 ? '' : `.${ref.path.join('.')}`;
  for (const key of callerSource.keys) target.keys.add(`${key}${suffix}`);
}

/** Caller-resolved source boundaries for every named component prop. */
export function linkComponentPropSources(
  nodes: Map<string, ComponentGraphNode>,
  roots: string[],
): Map<string, Map<string, LinkedComponentPropSource>> {
  const incoming = new Map<string, number>();
  const suppliedProps = new Map<string, Set<string>>();
  for (const node of nodes.values()) {
    for (const edge of node.edges) {
      incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
      const names = suppliedProps.get(edge.target) ?? new Set<string>();
      for (const name of Object.keys(edge.propSources ?? {})) names.add(name);
      suppliedProps.set(edge.target, names);
    }
  }

  const resolved = new Map<
    string,
    Map<string, MutablePropSource>
  >();
  const remaining = new Map(incoming);
  const pending = [...roots];
  while (pending.length > 0) {
    const caller = pending.shift()!;
    for (const edge of nodes.get(caller)?.edges ?? []) {
      for (const prop of suppliedProps.get(edge.target) ?? []) {
        const refs = edge.propSources?.[prop] ?? [{ type: 'root' as const }];
        const target = sourceFor(resolved, edge.target, prop);
        for (const ref of refs) resolveRef(resolved, caller, ref, target);
      }
      const count = (remaining.get(edge.target) ?? 1) - 1;
      remaining.set(edge.target, count);
      if (count === 0) pending.push(edge.target);
    }
  }

  return new Map(
    [...resolved].map(([component, props]) => [
      component,
      new Map(
        [...props].map(([prop, source]) => [
          prop,
          {
            keys: [...source.keys].sort(),
            rootFallback: source.rootFallback,
            transparent: source.transparent,
            publishedCallback: source.publishedCallback,
          },
        ]),
      ),
    ]),
  );
}
