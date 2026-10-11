/** Deferred compiler content retains its declaring scope across component props. */
import type { SceneComponent } from './definitions';
import type { Owner } from './ownership-model';
import type { SceneProps } from './values';
import type { SceneRowKey } from './application';

declare const contentBrand: unique symbol;
export interface SceneContent {
  readonly [contentBrand]: true;
}

interface ContentBase {
  readonly component: SceneComponent;
  readonly owner?: Owner;
}

type ContentDefinition = ContentBase &
  (
    | { readonly kind: 'content'; readonly read: () => SceneProps }
    | {
        readonly kind: 'rows';
        readonly read: (...args: unknown[]) => { key: SceneRowKey; props: SceneProps };
      }
  );

const definitions = new WeakMap<object, ContentDefinition>();

function create(definition: ContentDefinition): SceneContent {
  const content = Object.freeze({}) as SceneContent;
  definitions.set(content, definition);
  return content;
}

export function sceneContent(component: SceneComponent, read: () => SceneProps): SceneContent {
  return create({ kind: 'content', component, read });
}

export function sceneRenderCallback(
  component: SceneComponent,
  read: (...args: unknown[]) => { key: SceneRowKey; props: SceneProps },
): SceneContent {
  return create({ kind: 'rows', component, read });
}

export function isSceneContent(value: unknown): value is SceneContent {
  return typeof value === 'object' && value !== null && definitions.has(value);
}

/** Forwarding keeps the original owner; each declaring instance binds only once. */
export function bindSceneContent(
  content: SceneContent,
  owner: Owner,
  bindings: WeakMap<SceneContent, SceneContent>,
): SceneContent {
  const definition = definitions.get(content)!;
  if (definition.owner) {
    if (definition.owner.family !== owner.family) {
      throw new Error('Desktop content cannot cross application owner trees');
    }
    return content;
  }
  let bound = bindings.get(content);
  if (!bound) {
    bound = create({ ...definition, owner });
    bindings.set(content, bound);
  }
  return bound;
}

export function contentDefinition<K extends ContentDefinition['kind']>(
  value: unknown,
  kind: K,
): Extract<ContentDefinition, { kind: K }> & { owner: Owner } {
  const definition = isSceneContent(value) ? definitions.get(value) : undefined;
  if (!definition || definition.kind !== kind || !definition.owner) {
    throw new TypeError(`Desktop ${kind} requires compiler-owned content`);
  }
  if (definition.owner.disposed) throw new Error('Desktop content targets a disposed owner');
  return definition as Extract<ContentDefinition, { kind: K }> & { owner: Owner };
}
