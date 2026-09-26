/** Lightweight marker recognition used by mount even without hydration. */
export type HydrationMarkerKind = 'r' | 'c' | 'g' | 'l' | 'w' | 'd';
export type PairedHydrationMarkerKind = 'r' | 'c' | 'g' | 'l';

export interface HydrationOpenMarker {
  readonly type: 'open';
  readonly kind: HydrationMarkerKind;
  readonly identity: string;
  readonly attribute?: string;
}

export interface HydrationCloseMarker {
  readonly type: 'close';
}

export type HydrationMarker = HydrationOpenMarker | HydrationCloseMarker;

/** Parse one protocol comment body. Unrelated comments return null. */
export function parseHydrationMarker(data: string): HydrationMarker | null {
  if (data === '/mmd') return { type: 'close' };
  if (!data.startsWith('mmd:') || data.length < 7) return null;
  const kind = data[4];
  if (
    data[5] !== ':' ||
    (kind !== 'r' && kind !== 'c' && kind !== 'g' &&
      kind !== 'l' && kind !== 'w' && kind !== 'd')
  ) return null;
  const payload = data.slice(6);
  const attributeAt = payload.indexOf(' @ ');
  const identity = attributeAt === -1 ? payload : payload.slice(0, attributeAt);
  if (identity.length === 0 || identity.includes('>')) return null;
  const attribute = attributeAt === -1 ? undefined : payload.slice(attributeAt + 3);
  return {
    type: 'open', kind, identity,
    ...(attribute === undefined ? {} : { attribute }),
  };
}
