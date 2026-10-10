/** Authored scene definitions. Native tag semantics are owned by Rust tags.rs. */
export type SceneNode =
  | {
      readonly kind: 'element';
      readonly tag: string;
      readonly parent: number | null;
      readonly text: '';
      readonly attributes?: Readonly<Record<string, string>>;
      readonly style?: readonly CssDeclaration[];
    }
  | { readonly kind: 'text'; readonly parent: number | null; readonly text: string }
  | { readonly kind: 'region'; readonly parent: number | null; readonly multiple?: boolean };

export interface SceneTemplate {
  readonly id: string;
  readonly nodes: readonly SceneNode[];
  readonly slots: readonly { readonly node: number; readonly type: 'text' | 'value' }[];
  readonly events: readonly { readonly node: number; readonly type: SceneEventType }[];
  readonly stylesheets?: readonly CssRule[];
  /** Shared source identity keeps fragments from registering a module twice. */
  readonly stylesheet?: string;
}

export type SceneEventType =
  | 'click'
  | 'change'
  | 'keydown'
  | 'keyup'
  | 'pointerdown'
  | 'pointerup'
  | 'focus'
  | 'blur'
  | 'submit';

export interface CssDeclaration {
  readonly property: string;
  readonly value: string;
}
export interface CssSelector {
  readonly combinator: string | null;
  readonly selectors: readonly {
    readonly type: 'tag' | 'class' | 'id' | 'state' | 'scope';
    readonly name: string;
  }[];
}
export interface CssRule {
  readonly selectors: readonly (readonly CssSelector[])[];
  readonly declarations: readonly CssDeclaration[];
}

/** Renderer preparation, before geometry or GPU presentation exists. */
export interface FlowItem {
  readonly kind: 'container' | 'paragraph' | 'button' | 'input' | 'region';
  readonly source: number;
  readonly parent: number | null;
  readonly group: number | null;
}
export interface TextGroupValue {
  readonly text: string;
  readonly revision: number;
}
