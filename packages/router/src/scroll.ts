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
const MAX_SAVED_POSITIONS = 100;

export interface ScrollCoordinatorOptions {
  readonly window?: Window;
  readonly document?: Document;
  readonly history?: History;
}

export interface ScrollCoordinator {
  /** Capture current viewport scroll offset for the specified history key. */
  capture(key?: string | null): void;
  /** Restore or update viewport scroll offset for the destination URL and key. */
  restore(
    url: URL,
    type: 'load' | 'push' | 'replace' | 'pop',
    key?: string | null,
  ): void;
  /** Connect global scroll and navigation listeners. Returns a disconnect callback. */
  connect(): () => void;
  /** Clear in-memory snapshots and release listeners. */
  dispose(): void;
}

function readSessionStorage(key: string): ScrollPosition | undefined {
  try {
    if (typeof sessionStorage === 'undefined') return undefined;
    const raw = sessionStorage.getItem(`${SESSION_STORAGE_PREFIX}${key}`);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Partial<ScrollPosition>;
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    // Storage access may throw in restricted iframe / security environments.
  }
  return undefined;
}

function writeSessionStorage(key: string, position: ScrollPosition): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(
      `${SESSION_STORAGE_PREFIX}${key}`,
      JSON.stringify(position),
    );
  } catch {
    // QuotaExceeded or restricted storage — fail silently.
  }
}

function findHashElement(doc: Document, hash: string): Element | null {
  if (hash === '' || hash === '#') return null;
  const rawId = hash.startsWith('#') ? hash.slice(1) : hash;
  const decodedId = decodeURIComponent(rawId);
  return (
    doc.getElementById(decodedId) ??
    doc.querySelector(`[name="${CSS.escape(decodedId)}"]`)
  );
}

export function createScrollCoordinator(
  options: ScrollCoordinatorOptions = {},
): ScrollCoordinator {
  const win = options.window ?? (typeof window === 'undefined' ? undefined : window);
  const doc = options.document ?? (typeof document === 'undefined' ? undefined : document);
  const history = options.history ?? (typeof window === 'undefined' ? undefined : window.history);

  const memoryPositions = new Map<string, ScrollPosition>();
  let activeKey: string | null = null;
  let previousScrollRestoration: ScrollRestoration | undefined;
  let pendingFrame: number | null = null;
  let connected = false;

  function currentPosition(): ScrollPosition {
    if (win === undefined) return { x: 0, y: 0 };
    return {
      x: win.scrollX ?? win.pageXOffset ?? 0,
      y: win.scrollY ?? win.pageYOffset ?? 0,
    };
  }

  function savePosition(key: string, pos: ScrollPosition): void {
    if (memoryPositions.size >= MAX_SAVED_POSITIONS) {
      const oldestKey = memoryPositions.keys().next().value;
      if (oldestKey !== undefined) memoryPositions.delete(oldestKey);
    }
    memoryPositions.set(key, pos);
    writeSessionStorage(key, pos);
  }

  function getPosition(key: string): ScrollPosition | undefined {
    const memory = memoryPositions.get(key);
    if (memory !== undefined) return memory;
    const session = readSessionStorage(key);
    if (session !== undefined) {
      memoryPositions.set(key, session);
      return session;
    }
    return undefined;
  }

  function onScroll(): void {
    if (activeKey === null) return;
    if (pendingFrame !== null) return;
    pendingFrame = (win?.requestAnimationFrame ?? setTimeout)(() => {
      pendingFrame = null;
      if (activeKey !== null) {
        savePosition(activeKey, currentPosition());
      }
    }) as unknown as number;
  }

  function onBeforeUnload(): void {
    if (activeKey !== null) {
      savePosition(activeKey, currentPosition());
    }
  }

  return {
    capture(key) {
      const targetKey = key ?? activeKey;
      if (targetKey !== null && targetKey !== undefined) {
        savePosition(targetKey, currentPosition());
      }
    },

    restore(url, type, key) {
      activeKey = key ?? null;
      if (win === undefined) return;

      const schedule = (fn: () => void) => {
        if (typeof win.requestAnimationFrame === 'function') {
          win.requestAnimationFrame(fn);
        } else {
          setTimeout(fn, 0);
        }
      };

      // 1. Hash target has precedence when present (e.g. /docs#setup)
      if (url.hash !== '' && url.hash !== '#' && doc !== undefined) {
        schedule(() => {
          const element = findHashElement(doc, url.hash);
          if (element !== null) {
            element.scrollIntoView({ block: 'start' });
          } else {
            // Data or route component may finish mounting on next frame
            schedule(() => {
              findHashElement(doc, url.hash)?.scrollIntoView({ block: 'start' });
            });
          }
        });
        return;
      }

      // 2. Pop navigation (Back / Forward): restore saved scroll offset
      if (type === 'pop') {
        const saved = key === null || key === undefined ? undefined : getPosition(key);
        schedule(() => {
          if (saved !== undefined) {
            win.scrollTo(saved.x, saved.y);
          } else {
            win.scrollTo(0, 0);
          }
        });
        return;
      }

      // 3. Push navigation (new page): reset to top
      if (type === 'push') {
        schedule(() => {
          win.scrollTo(0, 0);
        });
        return;
      }

      // 4. Replace: retain current scroll position unless hash target is provided
    },

    connect() {
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
        win.addEventListener('beforeunload', onBeforeUnload, { passive: true });
      }

      return () => {
        if (!connected) return;
        connected = false;

        if (pendingFrame !== null && win !== undefined) {
          (win.cancelAnimationFrame ?? clearTimeout)(pendingFrame);
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
          win.removeEventListener('beforeunload', onBeforeUnload);
        }
      };
    },

    dispose() {
      memoryPositions.clear();
      activeKey = null;
      if (pendingFrame !== null && win !== undefined) {
        (win.cancelAnimationFrame ?? clearTimeout)(pendingFrame);
        pendingFrame = null;
      }
    },
  };
}
