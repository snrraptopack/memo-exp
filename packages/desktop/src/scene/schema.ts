/** Authored scene definitions. Native tag semantics are owned by Rust tags.rs. */
export type SceneNode =
  | { readonly kind: 'element'; readonly tag: string; readonly parent: number | null; readonly text: '' }
  | { readonly kind: 'text'; readonly parent: number | null; readonly text: string };

export interface SceneTemplate {
  readonly id: string;
  readonly nodes: readonly SceneNode[];
  readonly slots: readonly { readonly node: number; readonly type: 'text' }[];
  readonly events: readonly { readonly node: number; readonly type: 'click' }[];
}

/** Renderer preparation, before geometry or GPU presentation exists. */
export interface FlowItem {
  readonly kind: 'container' | 'paragraph' | 'button';
  readonly source: number;
  readonly parent: number | null;
  readonly group: number | null;
}
export interface TextGroupValue {
  readonly text: string;
  readonly revision: number;
}
