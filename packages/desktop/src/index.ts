export { createDesktopApplication, mountScene, sceneEvent, type DesktopApplication, type SceneInstance,
  type TextBinding, type SceneHandler } from './runtime/application';
export type { DesktopHost, SceneTemplate, SceneHandle, SceneOperation, SceneTransaction,
  SceneAcknowledgment, SceneSnapshot, TextWrite } from './bridge/protocol';
export type { SceneNode, FlowItem, TextGroupValue } from './scene/schema';
