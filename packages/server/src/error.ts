/** Type-only marker: an HTTP failure is not a successful client result. */
declare const errorResponseType: unique symbol;

export type ErrorResponse = Response & {
  readonly [errorResponseType]: true;
};

/** Return an expected HTTP failure. Use `return error(...)` in handlers. */
export function error(status: number, message: string): ErrorResponse {
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new RangeError('error() requires an HTTP status between 400 and 599');
  }
  return Response.json({ message }, { status }) as ErrorResponse;
}
