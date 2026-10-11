export {
  createDesktopApplication,
  mountScene,
  sceneEvent,
  type DesktopApplication,
  type SceneInstance,
  type TextBinding,
  type SceneHandler,
  type SceneChildBinding,
  type SceneMountOptions,
  type ScenePropertyBinding,
  type SceneRegionBinding,
  type SceneContentBinding,
  type SceneListBinding,
  type SceneRenderListBinding,
  type SceneRowKey,
} from './runtime/application';
export { defineSceneComponent, type SceneComponent } from './runtime/definitions';
export { sceneAttributes } from './runtime/properties';
export { sceneContent, sceneRenderCallback, type SceneContent } from './runtime/content';
export { sceneScope } from './runtime/scope';
export { defineSceneModule } from './runtime/modules';
export { affected as sceneSourcesChanged } from './runtime/values';
export { DesktopConnectionError } from './bridge/protocol';
export type {
  DesktopHost,
  SceneTemplate,
  SceneHandle,
  SceneOperation,
  SceneTransaction,
  SceneAcknowledgment,
  SceneSnapshot,
  SceneAttachment,
  TextWrite,
  PropertyWrite,
  NativeSceneEvent,
} from './bridge/protocol';
export type { SceneNode, FlowItem, TextGroupValue } from './scene/schema';
export { mount, runDesktopEntry, type DesktopRoot } from './runtime/mount';
