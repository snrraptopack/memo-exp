/** Version-one transport contract; Rust prepares authored tags for presentation. */
import type { FlowItem, SceneTemplate, TextGroupValue } from '../scene/schema';
export type { SceneTemplate } from '../scene/schema';

export interface SceneHandle { readonly id: number; readonly generation: number }
export interface TextWrite { readonly slot: number; readonly value: string }
export type SceneOperation =
  | { readonly kind: 'mount'; readonly handle: SceneHandle; readonly template: string; readonly values: readonly TextWrite[] }
  | { readonly kind: 'update'; readonly handle: SceneHandle; readonly values: readonly TextWrite[] }
  | { readonly kind: 'dispose'; readonly handle: SceneHandle };

export interface SceneTransaction { readonly sequence: number; readonly operations: readonly SceneOperation[] }
export interface SceneAcknowledgment { readonly sequence: number }
export interface NativeSceneEvent {
  readonly type: 'event';
  readonly handle: SceneHandle;
  readonly site: number;
  readonly payload?: unknown;
}

export interface DesktopHost {
  install(template: SceneTemplate): Promise<void>;
  commit(transaction: SceneTransaction): Promise<SceneAcknowledgment>;
}

export interface SceneSnapshot {
  readonly sequence: number;
  readonly renderer?: { readonly frames: number; readonly sequence: number; readonly shaping: number;
    readonly width: number; readonly height: number; readonly error: string | null;
    readonly boxes: readonly { readonly handle: SceneHandle; readonly source: number; readonly tag: string; readonly id: string | null;
      readonly x: number; readonly y: number; readonly width: number; readonly height: number }[] };
  readonly instances: readonly {
    readonly handle: SceneHandle;
    readonly template: string;
    readonly texts: readonly string[];
    readonly dirty: readonly number[];
    readonly presentation: readonly FlowItem[];
    readonly text_groups: readonly TextGroupValue[];
  }[];
}
