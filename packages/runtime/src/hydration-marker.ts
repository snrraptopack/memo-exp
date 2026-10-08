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

/** Shared identity validation; an attribute suffix is outside the identity. */
function markerIdentity(payload: string): string | null {
  const attributeAt = payload.indexOf(' @ ');
  const end = attributeAt === -1 ? payload.length : attributeAt;
  const identity = payload.slice(0, end);
  return identity.length === 0 || identity.includes('>') ? null : identity;
}

/** Ordinary mount needs only a root identity, not the region marker protocol. */
export function parseRootHydrationIdentity(data: string): string | null {
  if (!data.startsWith('mmd:r:')) return null;
  return markerIdentity(data.slice(6));
}

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
  const identity = markerIdentity(payload);
  if (identity === null) return null;
  const attribute = identity.length === payload.length ? undefined : payload.slice(identity.length + 3);
  return {
    type: 'open', kind, identity,
    ...(attribute === undefined ? {} : { attribute }),
  };
}
