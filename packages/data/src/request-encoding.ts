/** Optional body preparation on the existing request ownership boundary. */
import { prepareRequestBody } from './request';
import { installFetchBodyPreparer, type CoreDataRuntime } from './runtime-core';

export function enableRequestEncoding<T extends CoreDataRuntime>(runtime: T): T {
  installFetchBodyPreparer(runtime, prepareRequestBody);
  return runtime;
}
