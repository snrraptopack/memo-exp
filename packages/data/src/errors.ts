import type { StandardSchemaIssue } from './types';

export type RequestErrorKind =
  | 'network'
  | 'http'
  | 'decode'
  | 'validation';

export interface RequestErrorOptions<TData> {
  readonly kind: RequestErrorKind;
  readonly status?: number | null;
  readonly statusText?: string | null;
  readonly data?: TData;
  readonly issues?: readonly StandardSchemaIssue[];
  readonly cause?: unknown;
}

export class RequestError<TData = unknown> extends Error {
  readonly kind: RequestErrorKind;
  readonly status: number | null;
  readonly statusText: string | null;
  readonly data: TData | undefined;
  readonly issues: readonly StandardSchemaIssue[] | undefined;

  constructor(message: string, options: RequestErrorOptions<TData>) {
    super(message, { cause: options.cause });
    this.name = 'RequestError';
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.statusText = options.statusText ?? null;
    this.data = options.data;
    this.issues = options.issues;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === 'AbortError'
      : error instanceof Error && error.name === 'AbortError'
  );
}

export function toRequestError(error: unknown): RequestError {
  if (error instanceof RequestError) return error;
  return new RequestError(
    error instanceof Error ? error.message : 'Network request failed',
    { kind: 'network', cause: error },
  );
}
