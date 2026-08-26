/**
 * environment.ts - Phase 1.2 capability descriptor.
 *
 * Runtime behavior must be selected by explicit capabilities, not inferred
 * from `typeof window` probes scattered across modules. The active
 * application runtime carries one RenderEnvironment; the browser default
 * resolves lazily against ambient globals so existing imports behave
 * identically.
 *
 * Modes map to proposal phases:
 *   client-create  ordinary browser mounting (today's only path)
 *   server-dom     Phase 1.4 LinkeDOM reference rendering
 *   server-string  Phase 4 string writer
 *   hydrate        Phase 3 adoption
 */

import type { HydrationController } from './hydration';

export type RenderMode =
  | 'client-create'
  | 'server-dom'
  | 'server-string'
  | 'hydrate';

/**
 * Lifecycle capabilities. 'defer' is reserved for hydration (Phase 3):
 * recorded now, executed after adoption. Until then it behaves like
 * 'disabled'.
 */
export type Capability = 'run' | 'defer' | 'disabled';

/**
 * The node operations the RUNTIME itself performs (structural anchors,
 * fragments, range removal, host lookup). Compiled element creation goes
 * through the same document in server-dom mode once Phase 1.4 lands; the
 * string tier replaces it in Phase 4.
 */
export interface DocumentLike {
  readonly hidden?: boolean;
  createComment(data: string): Comment;
  createElement(tagName: string): Element;
  createElementNS(namespaceURI: string, qualifiedName: string): Element;
  createTextNode(data: string): Text;
  createDocumentFragment(): DocumentFragment;
  createRange?(): Range;
  getElementById(id: string): Element | null;
}

export interface RenderEnvironment {
  mode: RenderMode;
  /**
   * Node source for runtime-owned structure. Defaults to the ambient
   * document in client-create mode; server modes must inject one.
   */
  document: DocumentLike;
  /**
   * Driver for conservative volatile-pull frames. null disables pulling
   * entirely (servers render synchronously; nothing keeps ticking).
   */
  schedule: ((fn: () => void) => void) | null;
  effects: Capability;
  refs: Capability;
  hydration?: HydrationController;
}

function ambientDocument(): DocumentLike & Document {
  if (typeof document === 'undefined') {
    throw new Error(
      '[memo-dom] no document available - server environments must inject a DocumentLike into their application runtime',
    );
  }
  return document;
}

function ambientSchedule(): ((fn: () => void) => void) | null {
  return typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame.bind(globalThis)
    : null;
}

/** Browser default: ambient document, rAF pulls, everything runs. */
export function clientEnvironment(): RenderEnvironment {
  return {
    mode: 'client-create',
    // Resolved lazily per access so tests stubbing globals keep working.
    get document() {
      return ambientDocument();
    },
    get schedule() {
      return ambientSchedule();
    },
    effects: 'run',
    refs: 'run',
  };
}

/** Merge partial overrides over the client default. */
export function resolveEnvironment(
  overrides?: Partial<RenderEnvironment>,
): RenderEnvironment {
  const base = clientEnvironment();
  if (overrides === undefined) return base;
  return {
    mode: overrides.mode ?? base.mode,
    document: overrides.document ?? base.document,
    schedule:
      overrides.schedule === undefined ? base.schedule : overrides.schedule,
    effects: overrides.effects ?? base.effects,
    refs: overrides.refs ?? base.refs,
    hydration: overrides.hydration,
  };
}
