/** Resolve callbacks from ordered property bags into retained native event sites. */
import type { SceneEventType } from '../scene/schema';
import type { SceneHandler, ScenePropertyBinding } from './application';

export const sceneEventNames = {
  onClick: 'click',
  onChange: 'change',
  onKeyDown: 'keydown',
  onKeyUp: 'keyup',
  onPointerDown: 'pointerdown',
  onPointerUp: 'pointerup',
  onFocus: 'focus',
  onBlur: 'blur',
  onSubmit: 'submit',
} as const satisfies Record<string, SceneEventType>;

export function readPropertyEvent(
  name: string,
  value: unknown,
  tag: string,
  sites: ScenePropertyBinding['events'],
): { site: number; value: SceneHandler } | undefined {
  if (value == null || value === false) return undefined;
  if (typeof value !== 'function') throw new TypeError(`${name} requires a callback`);
  const event = sceneEventNames[name as keyof typeof sceneEventNames];
  const site = sites[event];
  if (site === undefined) throw new TypeError(`${name} is not supported on <${tag}>`);
  // Library callbacks can write through aliases that have no compiled source key.
  // Core invalidation remains conservative for these runtime-supplied handlers.
  return { site, value: { callback: value as SceneHandler['callback'], sources: null } };
}
