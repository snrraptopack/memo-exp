/**
 * list-keys.ts — Phase 0 hydration-safe keyed-list identity encoding.
 *
 * List row identity embeds the user-provided key into an entity id segment
 * (`<idPrefix>/Row[<encoded>]`). The historical encoding was `String(key)`:
 *
 *   - `1`, `"1"`, `1n` and `true`/`"true"` collapsed into identical ids;
 *   - raw string keys injected protocol-significant characters (`/` splits
 *     id segments, `]` closes the row marker, `%` pre-empts future escapes).
 *
 * The contract below is the hydration-safe replacement. Every PRIMITIVE key
 * encodes deterministically with an explicit type tag, so server and client
 * builds of one graph derive identical identity from identical data:
 *
 *   number  → `n:<canonical digits>`   (String(number); -0 encodes as `0`,
 *                                       SameValueZero makes that equivalent)
 *   bigint  → `g:<decimal digits>`
 *   boolean → `t` | `f`
 *   string  → `s:<escaped>`            (every code point outside
 *                                       A–Z a–z 0–9 _ . ~ - becomes
 *                                       uppercase percent-escape UTF-8)
 *
 * NON-primitive keys (objects, symbols, functions, null, undefined) return
 * `null` here and fall back to process-local synthetic ids. DECLARED SSR
 * LIMITATION: such keys cannot survive a server→client transfer; hydration
 * requires stable primitive keys. This is a documented diagnostic boundary,
 * not silent cross-request sharing.
 */

const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/** Percent-escape every code point outside the safe id-segment whitelist. */
function escapeSegment(raw: string): string | null {
  if (SAFE_SEGMENT.test(raw)) return raw;
  let out = '';
  for (const character of raw) {
    if (SAFE_SEGMENT.test(character)) {
      out += character;
    } else {
      try {
        out += encodeURIComponent(character);
      } catch {
        // Lone surrogates have no UTF-8 form and cannot round-trip.
        return null;
      }
    }
  }
  return out;
}

/**
 * Encode a list key for embedding in an entity id / hydration marker.
 * Returns `null` when the key is not a hydration-stable primitive.
 */
export function encodeListKey(key: unknown): string | null {
  const kind = typeof key;
  if (kind === 'number') {
    // NaN has no canonical literal form and can never round-trip; ±Infinity
    // stringifies canonically and is SameValueZero-stable.
    if (Number.isNaN(key as number)) return null;
    const encoded = escapeSegment(String(key));
    return encoded === null ? null : `n:${encoded}`;
  }
  if (kind === 'string') {
    const encoded = escapeSegment(key as string);
    return encoded === null ? null : `s:${encoded}`;
  }
  if (kind === 'bigint') {
    const encoded = escapeSegment((key as bigint).toString());
    return encoded === null ? null : `g:${encoded}`;
  }
  if (kind === 'boolean') return (key as boolean) ? 't' : 'f';
  return null;
}

function unescapeSegment(encoded: string): string | null {
  if (!encoded.includes('%')) return encoded;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/**
 * Inverse of `encodeListKey`. Returns `undefined` for input this contract
 * did not produce (including synthetic `#N` segments, which were never
 * hydration-stable).
 */
export function decodeListKey(encoded: string): unknown {
  if (encoded === 't') return true;
  if (encoded === 'f') return false;
  if (encoded.startsWith('n:')) {
    const raw = unescapeSegment(encoded.slice(2));
    if (raw === null || raw === '' || Number.isNaN(Number(raw))) return undefined;
    return Number(raw);
  }
  if (encoded.startsWith('g:')) {
    const raw = unescapeSegment(encoded.slice(2));
    if (raw === null || !/^-?\d+$/.test(raw)) return undefined;
    return BigInt(raw);
  }
  if (encoded.startsWith('s:')) {
    const raw = unescapeSegment(encoded.slice(2));
    return raw === null ? undefined : raw;
  }
  return undefined;
}
