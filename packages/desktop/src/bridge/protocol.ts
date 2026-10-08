/** Version-one scene contract; the initial bridge uses JSON lines for inspection. */
export interface SceneTemplate {
  readonly id: string;
  readonly nodes: readonly { readonly kind: 'container' | 'button' | 'text'; readonly parent: number | null; readonly text: string }[];
  readonly slots: readonly { readonly node: number; readonly type: 'text' }[];
  readonly events: readonly { readonly node: number; readonly type: 'click' }[];
}

export interface SceneHandle { readonly id: number; readonly generation: number }
export interface TextWrite { readonly slot: number; readonly value: string }
export type SceneOperation =
  | { readonly kind: 'mount'; readonly handle: SceneHandle; readonly template: string; readonly values: readonly TextWrite[] }
  | { readonly kind: 'update'; readonly handle: SceneHandle; readonly values: readonly TextWrite[] }
  | { readonly kind: 'dispose'; readonly handle: SceneHandle };

export interface SceneTransaction { readonly sequence: number; readonly operations: readonly SceneOperation[] }
export interface SceneAcknowledgment { readonly sequence: number }

export interface DesktopHost {
  install(template: SceneTemplate): Promise<void>;
  commit(transaction: SceneTransaction): Promise<SceneAcknowledgment>;
}

export interface SceneSnapshot {
  readonly sequence: number;
  readonly instances: readonly {
    readonly handle: SceneHandle;
    readonly template: string;
    readonly texts: readonly string[];
    readonly dirty: readonly number[];
  }[];
}
