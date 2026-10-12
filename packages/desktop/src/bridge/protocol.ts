/** Version-one transport contract; Rust prepares authored tags for presentation. */
import type { CssDeclaration, FlowItem, SceneNode, SceneTemplate, TextGroupValue } from '../scene/schema';
export type { SceneTemplate } from '../scene/schema';

export interface SceneHandle {
  readonly id: number;
  readonly generation: number;
}
export interface SceneAttachment {
  readonly handle: SceneHandle;
  readonly node: number;
}
export interface TextWrite {
  readonly slot: number;
  readonly value: string;
}
/** Complete attributes/style for one element; omitted keys remove earlier values. */
export interface PropertyWrite {
  readonly node: number;
  readonly attributes: Readonly<Record<string, string>>;
  readonly style: readonly CssDeclaration[] | string;
}
export type SceneOperation =
  | {
      readonly kind: 'mount';
      readonly handle: SceneHandle;
      readonly template: string;
      readonly values: readonly TextWrite[];
      readonly attach_to?: SceneAttachment;
    }
  | { readonly kind: 'update'; readonly handle: SceneHandle; readonly values: readonly TextWrite[] }
  | {
      readonly kind: 'order';
      readonly handle: SceneHandle;
      readonly node: number;
      readonly children: readonly SceneHandle[];
    }
  | {
      readonly kind: 'properties';
      readonly handle: SceneHandle;
      readonly properties: readonly PropertyWrite[];
    }
  | { readonly kind: 'dispose'; readonly handle: SceneHandle };

export interface SceneTransaction {
  readonly sequence: number;
  readonly operations: readonly SceneOperation[];
}
export interface SceneAcknowledgment {
  readonly sequence: number;
}
export interface NativeSceneEvent {
  readonly type: 'event';
  readonly handle: SceneHandle;
  readonly site?: number;
  readonly node?: number;
  /** Token for a native default action deferred until the handler finishes. */
  readonly dispatch?: number;
  readonly payload?: unknown;
  readonly edit?: number;
}
export interface DesktopHost {
  /** Optional platform clock. Headless hosts leave conservative pulls disabled. */
  nextFrame?(): Promise<{ readonly visible: boolean }>;
  /** Reject only for explicit refusal; ambiguous failures must use DesktopConnectionError. */
  install(template: SceneTemplate): Promise<void>;
  commit(transaction: SceneTransaction): Promise<SceneAcknowledgment>;
}
/** Acceptance is unknown: publication must stop instead of reusing its sequence. */
export class DesktopConnectionError extends Error {
  readonly acceptance = 'unknown';
}

export interface SceneSnapshot {
  readonly sequence: number;
  /** Accepted scene flow after transparent regions are expanded. Instance
   * presentation/text_groups remain projections of their local templates. */
  readonly flow?: {
    readonly items: readonly {
      readonly kind: 'container' | 'paragraph' | 'button' | 'input';
      readonly source: { readonly handle: SceneHandle; readonly node: number };
      readonly parent: number | null;
      readonly group: number | null;
      readonly anchor: { readonly handle: SceneHandle; readonly node: number } | null;
    }[];
    readonly text_groups: readonly TextGroupValue[];
  };
  readonly renderer?: {
    readonly frames: number;
    readonly sequence: number;
    readonly shaping: number;
    readonly width: number;
    readonly height: number;
    readonly error: string | null;
    readonly scroll?: { readonly offset: number; readonly max: number; readonly viewport: number };
    readonly inputs?: readonly {
      readonly handle: SceneHandle;
      readonly node: number;
      readonly text: string;
    }[];
    readonly focused?: { readonly handle: SceneHandle; readonly node: number } | null;
    readonly event_to_commit_ms?: number | null;
    readonly event_to_paint_ms?: number | null;
    readonly commit_to_paint_ms?: number | null;
    readonly layout_ms?: number;
    readonly frame_ms?: number;
    readonly boxes: readonly {
      readonly handle: SceneHandle;
      readonly source: number;
      readonly tag: string;
      readonly id: string | null;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }[];
    /** Measured inline source fragments. These are shaped text regions, not
     * independently sized layout items; a wrapped source can have several. */
    readonly inline_ranges?: readonly {
      readonly handle: SceneHandle;
      readonly source: number;
      readonly id: string | null;
      readonly tag: string;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }[];
    readonly inline_geometry?: number;
    /** Source ancestry whose hover refinements were used by the painted frame. */
    readonly inline_hovered?: readonly {
      readonly handle: SceneHandle;
      readonly node: number;
    }[];
  };
  readonly instances: readonly {
    readonly handle: SceneHandle;
    readonly attach_to?: SceneAttachment;
    readonly orders?: Readonly<Record<string, readonly SceneHandle[]>>;
    readonly template: string;
    readonly properties?: Readonly<Record<string, Extract<SceneNode, { kind: 'element' }>>>;
    readonly texts: readonly string[];
    readonly dirty: readonly number[];
    readonly presentation: readonly FlowItem[];
    readonly text_groups: readonly TextGroupValue[];
    /** Accepted CSS properties per source node: normal, hover, focus, both. */
    readonly styles?: readonly {
      readonly states: readonly Readonly<Record<string, string>>[];
    }[];
  }[];
}
