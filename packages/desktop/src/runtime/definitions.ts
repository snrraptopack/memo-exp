/** Immutable compiler metadata lets inactive branches install without running setup. */
import type { SceneTemplate } from '../bridge/protocol';
import type { SceneInstance } from './application';

export type SceneComponent = (props: Readonly<Record<string, unknown>>) => SceneInstance;
interface Definition { template: SceneTemplate; dependencies: () => readonly SceneComponent[] }
const definitions = new WeakMap<SceneComponent, Definition>();
export function defineSceneComponent(component: SceneComponent, template: SceneTemplate, dependencies: () => readonly SceneComponent[]): void {
  if (definitions.has(component)) throw new Error('Desktop component definition is immutable');
  definitions.set(component, { template, dependencies });
}
export function componentTemplates(components: readonly SceneComponent[]): SceneTemplate[] {
  const templates: SceneTemplate[] = [];
  const visited = new Set<SceneComponent>();
  const pending = [...components];
  while (pending.length) {
    const component = pending.pop()!;
    if (visited.has(component)) continue;
    visited.add(component);
    const definition = definitions.get(component);
    if (!definition) throw new Error('Conditional desktop components require compiled definitions');
    templates.push(definition.template);
    pending.push(...definition.dependencies());
  }
  return templates;
}
