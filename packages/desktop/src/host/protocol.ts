/** Versioned presentation records. Application state remains in the shared core. */
export const PROTOCOL_VERSION = 1;
export const MAX_PACKET_BYTES = 1_048_576;
export const MAX_OPERATIONS = 4_096;

export interface Owner {
  readonly id: string;
  readonly generation: number;
}

export interface SourceReference {
  readonly owner: Owner;
  readonly source: number;
}

export interface QualifiedName {
  readonly namespace: string;
  readonly local: string;
  readonly prefix?: string | null;
}

export type Destination =
  | { readonly kind: 'body' }
  | { readonly kind: 'element' | 'region'; readonly source: SourceReference };

export type SourceNode =
  | {
      readonly kind: 'element';
      readonly name: QualifiedName;
      readonly attributes: readonly { readonly name: QualifiedName; readonly value: string }[];
    }
  | { readonly kind: 'text' | 'comment'; readonly value: string };

export interface Template {
  readonly key: string;
  readonly nodes: readonly { readonly parent: number | null; readonly node: SourceNode }[];
}

export type Operation =
  | { readonly op: 'text'; readonly target: SourceReference; readonly value: string }
  | { readonly op: 'setValue'; readonly target: SourceReference; readonly value: string; readonly revision: number; readonly version: number }
  | {
      readonly op: 'setAttribute';
      readonly target: SourceReference;
      readonly name: QualifiedName;
      readonly value: string;
    }
  | { readonly op: 'removeAttribute'; readonly target: SourceReference; readonly name: QualifiedName }
  | {
      readonly op: 'mount';
      readonly owner: Owner;
      readonly template: string;
      readonly target: Destination;
    }
  | { readonly op: 'moveBefore'; readonly owner: Owner; readonly before: Owner }
  | { readonly op: 'moveToEnd' | 'retire'; readonly owner: Owner };

export interface Publication {
  readonly templates?: readonly Template[];
  readonly operations: readonly Operation[];
}

export interface Acceptance {
  readonly version: 1;
  readonly status: 'accepted';
  readonly sequence: number;
}

export interface Rejection {
  readonly version: 1;
  readonly status: 'refused' | 'fatal';
  readonly expectedSequence: number | null;
  readonly code: string;
  readonly message: string;
}

export type PublicationReply = Acceptance | Rejection;

export class HostError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HostError';
  }
}

export class PublicationRefusedError extends HostError {
  constructor(readonly reply: Rejection) {
    super(reply.code, reply.message);
    this.name = 'PublicationRefusedError';
  }
}

/** Refuse malformed or future replies instead of advancing accepted lifecycle. */
export function parseReply(value: unknown): PublicationReply {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HostError('invalidReply', 'Native reply must be an object');
  }

  const record = value as Record<string, unknown>;
  const accepted = record.status === 'accepted';
  const fields = accepted
    ? ['version', 'status', 'sequence']
    : ['version', 'status', 'expectedSequence', 'code', 'message'];

  if (
    record.version !== PROTOCOL_VERSION ||
    Object.keys(record).length !== fields.length ||
    !fields.every(field => Object.hasOwn(record, field))
  ) {
    throw new HostError('invalidReply', 'Native reply fields or version are invalid');
  }

  if (accepted && isSequence(record.sequence)) {
    return record as unknown as Acceptance;
  }

  if (
    (record.status === 'refused' || record.status === 'fatal') &&
    (isSequence(record.expectedSequence) ||
      (record.status === 'fatal' && record.expectedSequence === null)) &&
    typeof record.code === 'string' &&
    record.code.length > 0 &&
    record.code.length <= 128 &&
    typeof record.message === 'string' &&
    record.message.length <= 1024 &&
    [...record.message].length <= 512
  ) {
    return record as unknown as Rejection;
  }

  throw new HostError('invalidReply', 'Native reply status, sequence or diagnostic is invalid');
}

function isSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
