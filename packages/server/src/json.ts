/** Type-only marker for JSON body inference in generated client declarations. */
declare const jsonBodyType: unique symbol;

export type JsonResponse<T> = Response & {
  readonly [jsonBodyType]: T;
};

/** A native Response; the extra type information only helps client inference. */
export function json<T>(data: T, init?: ResponseInit): JsonResponse<T> {
  return Response.json(data, init) as JsonResponse<T>;
}
