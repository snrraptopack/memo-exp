import type { FetchResource } from './types';

export type ResourceWriter = <T>(resource: FetchResource<T>, change: (current: T | undefined) => T | void, mutable: boolean) => void;
let writer: ResourceWriter;

export function installResourceWriter(write: ResourceWriter): void { writer = write; }

export const dispatchResourceWrite: ResourceWriter = (resource, change, mutable) => {
  // Public resource construction installs the writer before exposing methods.
  writer(resource, change, mutable);
};
