/**
 * @memoized-dom/router — Deterministic scroll position restoration coordinator.
 *
 * Manages history-keyed scroll positions, hash navigation, and manual scroll
 * restoration across single-page transitions without exposing any extra
 * public API surface.
 */

export interface ScrollPosition {
  readonly x: number;
  readonly y: number;
}

const SESSION_STORAGE_PREFIX = '__mmd_scroll_';
/** Outside the position prefix so it never collides with a history key. */
const SESSION_STORAGE_INDEX = '__mmd_scroll#index';
const MAX_SAVED_POSITIONS = 100;

export interface ScrollCoordinatorOptions {
  readonly window?: Window;
  readonly document?: Document;
  readonly history?: History;
}

export interface ScrollCoordinator {
  /** Capture current viewport scroll offset for the specified history key. */
  capture(key?: string | null): void;
  /** Restore after optional renderer readiness; obsolete work is cancelled. */
  restore(
    url: URL,
    type: 'load' | 'push' | 'replace' | 'pop',
    key?: string | null,
    ready?: PromiseLike<void>,
  ): void;
  /** Cancel work belonging to an obsolete destination. */
  cancel(): void;
  /** Connect global scroll and navigation listeners. Returns a disconnect callback. */
  connect(): () => void;
  /** Clear in-memory snapshots and release listeners. */
  dispose(): void;
}

function readSessionStorage(storage: Storage | undefined, key: string): ScrollPosition | undefined {
  try {
    if (storage === undefined) return undefined;
    const raw = storage.getItem(`${SESSION_STORAGE_PREFIX}${key}`);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Partial<ScrollPosition>;
    if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
      return { x: parsed.x!, y: parsed.y! };
    }
  } catch {
    // Storage access may throw in restricted iframe / security environments.
  }
  return undefined;
}

function readSessionIndex(storage: Storage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SESSION_STORAGE_INDEX) ?? '[]');
    if (Array.isArray(parsed)) return parsed.filter(key => typeof key === 'string');
  } catch {
    // Restricted storage or a corrupted index starts a fresh index.
  }
  return [];
}

function findHashElement(doc: Document, hash: string): Element | null {
  if (hash === '' || hash === '#') return null;
  const rawId = hash.startsWith('#') ? hash.slice(1) : hash;
  let decodedId: string;
  try { decodedId = decodeURIComponent(rawId); }
  catch { decodedId = rawId; }
  return (
    doc.getElementById(decodedId) ??
    doc.getElementsByName(decodedId)[0] ?? null
  );
}

export function createScrollCoordinator(
  options: ScrollCoordinatorOptions = {},
): ScrollCoordinator {
  const win = options.window ?? (typeof window === 'undefined' ? undefined : window);
  const doc = options.document ?? win?.document;
  const history = options.history ?? win?.history;
  let storage: Storage | undefined;
  try { storage = win?.sessionStorage; } catch { /* Restricted storage. */ }

  const memoryPositions = new Map<string, ScrollPosition>();
  let storedKeys: string[] | null = null;
  let activeKey: string | null = null;
  let previousScrollRestoration: ScrollRestoration | undefined;
  let pendingFrame: number | null = null;
  let connected = false;
  let disposed = false;
  let awaitingRestoration = false;
  let generation = 0;
  const restoreFrames = new Map<number, boolean>();
  let hashObserver: MutationObserver | null = null;
  let disconnectListeners: (() => void) | null = null;

  function cancelRestore(): void {
    generation++;
    awaitingRestoration = false;
    for (const [handle, animationFrame] of restoreFrames) {
      if (animationFrame) win?.cancelAnimationFrame?.(handle);
      else clearTimeout(handle);
    }
    restoreFrames.clear();
    hashObserver?.disconnect();
    hashObserver = null;
  }

  function schedule(fn: () => void, token: number): void {
    if (win === undefined || disposed || token !== generation) return;
    let ran = false;
    let handle = 0;
    const run = () => {
      ran = true;
      restoreFrames.delete(handle);
      if (!disposed && token === generation) fn();
    };
    const animationFrame = typeof win.requestAnimationFrame === 'function';
    handle = animationFrame ? win.requestAnimationFrame(run) : setTimeout(run, 0) as unknown as number;
    // Test adapters may run synchronously; do not retain a completed handle.
    if (!ran) restoreFrames.set(handle, animationFrame);
  }

  function currentPosition(): ScrollPosition {
    if (win === undefined) return { x: 0, y: 0 };
    return {
      x: win.scrollX ?? win.pageXOffset ?? 0,
      y: win.scrollY ?? win.pageYOffset ?? 0,
    };
  }

  /** Storage writes are synchronous, so they happen only when an entry is left or hidden. */
  function persistPosition(key: string, pos: ScrollPosition): void {
    if (storage === undefined) return;
    storedKeys ??= readSessionIndex(storage);
    const existing = storedKeys.indexOf(key);
    if (existing !== -1) storedKeys.splice(existing, 1);
    storedKeys.push(key);
    try {
      while (storedKeys.length > MAX_SAVED_POSITIONS) {
        storage.removeItem(`${SESSION_STORAGE_PREFIX}${storedKeys.shift()!}`);
      }
      storage.setItem(`${SESSION_STORAGE_PREFIX}${key}`, JSON.stringify(pos));
      storage.setItem(SESSION_STORAGE_INDEX, JSON.stringify(storedKeys));
    } catch {
      // QuotaExceeded or restricted storage — fail silently.
    }
  }

  function savePosition(key: string, pos: ScrollPosition, persist: boolean): void {
    if (!memoryPositions.has(key) && memoryPositions.size >= MAX_SAVED_POSITIONS) {
      const oldestKey = memoryPositions.keys().next().value;
      if (oldestKey !== undefined) memoryPositions.delete(oldestKey);
    }
    memoryPositions.set(key, pos);
    if (persist) persistPosition(key, pos);
  }

  function getPosition(key: string): ScrollPosition | undefined {
    const memory = memoryPositions.get(key);
    if (memory !== undefined) return memory;
    const session = readSessionStorage(storage, key);
    if (session !== undefined) {
      memoryPositions.set(key, session);
      return session;
    }
    return undefined;
  }

  function onScroll(): void {
    if (awaitingRestoration || disposed) return;
    if (activeKey === null) return;
    if (pendingFrame !== null) return;
    const key = activeKey;
    const token = generation;
    let ran = false;
    const run = () => {
      ran = true;
      pendingFrame = null;
      if (!disposed && key === activeKey && token === generation) {
        savePosition(key, currentPosition(), false);
      }
    };
    const handle = win?.requestAnimationFrame !== undefined
      ? win.requestAnimationFrame(run)
      : setTimeout(run, 0) as unknown as number;
    if (!ran) pendingFrame = handle;
  }

  /** `pagehide` keeps back/forward cache eligibility, unlike `beforeunload`. */
  function onPageHide(): void {
    if (activeKey !== null && !awaitingRestoration && !disposed) {
      savePosition(activeKey, currentPosition(), true);
    }
  }

  function onVisibilityChange(): void {
    if (doc?.visibilityState === 'hidden') onPageHide();
  }

  function onScrollIntent(event: Event): void {
    const key = (event as KeyboardEvent).key;
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(key)) {
      cancelRestore();
    }
  }

  return {
    capture(key) {
      if (disposed) return;
      const targetKey = key ?? activeKey;
      if (awaitingRestoration && targetKey === activeKey) return;
      if (targetKey !== null && targetKey !== undefined) {
        savePosition(targetKey, currentPosition(), true);
      }
    },

    cancel: cancelRestore,

    restore(url, type, key, ready) {
      if (disposed) return;
      cancelRestore();
      const token = generation;
      activeKey = key ?? null;
      if (win === undefined) return;
      awaitingRestoration = true;
      const apply = () => {
        if (disposed || token !== generation) return;
        // A saved history offset takes precedence over the entry's hash.
        const saved = type === 'pop' && key != null ? getPosition(key) : undefined;
        if (saved !== undefined) {
          schedule(() => {
            awaitingRestoration = false;
            win.scrollTo(saved.x, saved.y);
          }, token);
          return;
        }

        // Hash targets may be created by a later resource commit. Observe DOM
        // readiness instead of assuming they appear within two animation frames.
        if (url.hash !== '' && url.hash !== '#' && doc !== undefined) {
          const tryHash = () => {
            if (disposed || token !== generation) return true;
            const element = findHashElement(doc, url.hash);
            if (element === null) return false;
            hashObserver?.disconnect();
            hashObserver = null;
            awaitingRestoration = false;
            element.scrollIntoView({ block: 'start' });
            return true;
          };
          schedule(() => {
            if (tryHash()) return;
            const Observer = (win as unknown as { MutationObserver?: typeof MutationObserver }).MutationObserver;
            if (Observer !== undefined && doc.documentElement != null) {
              hashObserver = new Observer(() => { tryHash(); });
              hashObserver.observe(doc.documentElement, {
                childList: true, subtree: true, attributes: true,
                attributeFilter: ['id', 'name'],
              });
            } else awaitingRestoration = false;
          }, token);
          return;
        }

        // New pages reset; history traversals without a snapshot fall back to top.
        if (type === 'push' || type === 'pop') {
          schedule(() => {
            awaitingRestoration = false;
            win.scrollTo(0, 0);
          }, token);
          return;
        }

        // Load/replace retain current position when no hash target is provided.
        awaitingRestoration = false;
      };
      if (ready === undefined) apply();
      else void Promise.resolve(ready).then(apply, () => {
        if (token === generation) cancelRestore();
      });
    },

    connect() {
      if (disposed) throw new Error('Cannot connect a disposed scroll coordinator');
      if (connected) return () => {};
      connected = true;

      if (history !== undefined && 'scrollRestoration' in history) {
        previousScrollRestoration = history.scrollRestoration;
        try {
          history.scrollRestoration = 'manual';
        } catch {
          // Some custom or mock history objects may reject assignment.
        }
      }

      if (win !== undefined) {
        win.addEventListener('scroll', onScroll, { passive: true });
        win.addEventListener('pagehide', onPageHide);
        // User intent takes precedence over a target appearing much later.
        win.addEventListener('wheel', cancelRestore, { passive: true });
        win.addEventListener('touchstart', cancelRestore, { passive: true });
        win.addEventListener('keydown', onScrollIntent);
      }
      doc?.addEventListener?.('visibilitychange', onVisibilityChange);

      disconnectListeners = () => {
        if (!connected) return;
        connected = false;
        cancelRestore();

        if (pendingFrame !== null && win !== undefined) {
          if (win.cancelAnimationFrame !== undefined) win.cancelAnimationFrame(pendingFrame);
          else clearTimeout(pendingFrame);
          pendingFrame = null;
        }

        if (
          history !== undefined &&
          previousScrollRestoration !== undefined &&
          'scrollRestoration' in history
        ) {
          try {
            history.scrollRestoration = previousScrollRestoration;
          } catch {
            // Ignore failure on restoration.
          }
        }

        if (win !== undefined) {
          win.removeEventListener('scroll', onScroll);
          win.removeEventListener('pagehide', onPageHide);
          win.removeEventListener('wheel', cancelRestore);
          win.removeEventListener('touchstart', cancelRestore);
          win.removeEventListener('keydown', onScrollIntent);
        }
        doc?.removeEventListener?.('visibilitychange', onVisibilityChange);
      };
      return disconnectListeners;
    },

    dispose() {
      if (disposed) return;
      disconnectListeners?.();
      disposed = true;
      cancelRestore();
      memoryPositions.clear();
      activeKey = null;
      if (pendingFrame !== null && win !== undefined) {
        if (win.cancelAnimationFrame !== undefined) win.cancelAnimationFrame(pendingFrame);
        else clearTimeout(pendingFrame);
        pendingFrame = null;
      }
    },
  };
}
