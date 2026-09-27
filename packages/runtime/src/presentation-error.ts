/** Failure categories delivered to the shared Group error arm. */
export type PresentationErrorKind = 'request' | 'module' | 'crash';

export interface PresentationError extends Error {
  readonly kind: PresentationErrorKind;
  readonly cause: unknown;
  readonly requestKind?: string;
  readonly status?: number | null;
  readonly statusText?: string | null;
  readonly data?: unknown;
  readonly issues?: readonly unknown[];
}

const requestErrorMarker = Symbol.for('memoized-dom:request-error');
const normalized = new WeakMap<object, Map<PresentationErrorKind, PresentationError>>();
const presentationErrors = new WeakSet<object>();

/** @internal Preserve transport errors while normalizing only presentation. */
export function toPresentationError(cause: unknown, kind?: PresentationErrorKind): PresentationError {
  const object = ((typeof cause === 'object' && cause !== null) || typeof cause === 'function')
    ? cause as object : undefined;
  if (object !== undefined && presentationErrors.has(object)) return cause as PresentationError;
  const request = object as (Record<PropertyKey, unknown> | undefined);
  const category = kind ?? (request?.[requestErrorMarker] === true ? 'request' : 'crash');
  const cached = object === undefined ? undefined : normalized.get(object)?.get(category);
  if (cached !== undefined) return cached;
  const message = cause instanceof Error ? cause.message
    : typeof cause === 'string' ? cause : 'Rendering failed';
  const error = Object.assign(new Error(message, { cause }), {
    name: 'PresentationError', kind: category,
    ...(category !== 'request' ? {} : {
      requestKind: request?.kind as string | undefined,
      status: request?.status as number | null | undefined,
      statusText: request?.statusText as string | null | undefined,
      data: request?.data,
      issues: request?.issues as readonly unknown[] | undefined,
    }),
  }) as PresentationError;
  presentationErrors.add(error);
  if (object !== undefined) {
    let categories = normalized.get(object);
    if (categories === undefined) { categories = new Map(); normalized.set(object, categories); }
    categories.set(category, error);
  }
  return error;
}
