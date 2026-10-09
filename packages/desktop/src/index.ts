export { createDesktopApplication, mountScene, sceneEvent, type DesktopApplication, type SceneInstance,
  type TextBinding, type SceneHandler, type SceneChildBinding, type SceneMountOptions, type SceneRegionBinding, type SceneListBinding, type SceneRowKey } from './runtime/application';
export { defineSceneComponent, type SceneComponent } from './runtime/definitions';
export { DesktopConnectionError } from './bridge/protocol';
export type { DesktopHost, SceneTemplate, SceneHandle, SceneOperation, SceneTransaction,
  SceneAcknowledgment, SceneSnapshot, SceneAttachment, TextWrite, NativeSceneEvent, DesktopInputEvent } from './bridge/protocol';
export type { SceneNode, FlowItem, TextGroupValue } from './scene/schema';
export { mount, runDesktopEntry, type DesktopRoot } from './runtime/mount';
