/**
 * R13: primitives compare by Object.is and distinct primitive arrays compare
 * element-wise. Mutable references propagate because identity cannot reveal
 * an in-place change.
 */
export function computedChanged(prev: unknown, next: unknown): boolean {
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev === next) return true;
    if (prev.length !== next.length) return true;
    for (let i = 0; i < prev.length; i++) {
      if (!Object.is(prev[i], next[i])) return true;
      if (isMutableReference(prev[i])) return true;
    }
    return false;
  }
  if (isMutableReference(prev) || isMutableReference(next)) return true;
  return !Object.is(prev, next);
}

/** Equal plain assignments inside effects do not create feedback work. */
export function effectAssignmentChanged(prev: unknown, next: unknown): boolean {
  return !Object.is(prev, next);
}

function isMutableReference(value: unknown): boolean {
  return (
    (typeof value === 'object' && value !== null) ||
    typeof value === 'function'
  );
}
