export { createDesktopApplication, mountScene, sceneEvent, type DesktopApplication, type SceneInstance,
  type TextBinding, type SceneHandler } from './runtime/application';
export type { DesktopHost, SceneTemplate, SceneHandle, SceneOperation, SceneTransaction,
  SceneAcknowledgment, SceneSnapshot, TextWrite, NativeSceneEvent } from './bridge/protocol';
export type { SceneNode, FlowItem, TextGroupValue } from './scene/schema';
export { mount, runDesktopEntry, type DesktopRoot } from './runtime/mount';
