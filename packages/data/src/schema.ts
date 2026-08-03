import { RequestError } from './errors';
import type { InferSchemaOutput, StandardSchemaV1 } from './types';

export async function validateValue<TSchema extends StandardSchemaV1>(
  schema: TSchema,
  value: unknown,
): Promise<InferSchemaOutput<TSchema>> {
  const result = await schema['~standard'].validate(value);
  if (result.issues !== undefined) {
    throw new RequestError('Response validation failed', {
      kind: 'validation',
      issues: result.issues,
      data: value,
    });
  }
  return result.value as InferSchemaOutput<TSchema>;
}
