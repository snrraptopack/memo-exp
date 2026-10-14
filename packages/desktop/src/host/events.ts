/** Private wire events. Application callbacks retain ordinary DOM JSX types. */
import { HostError, type SourceReference } from './protocol';

export interface NativeEventPacket {
  readonly kind: 'event';
  readonly version: 1;
  readonly dispatchId: number;
  readonly eventType: 'click';
  readonly path: readonly SourceReference[];
  readonly cancelable: boolean;
  readonly bubbles: boolean;
  readonly timestamp: number;
  readonly sceneSequence: number;
}

export interface DispatchDecision {
  readonly kind: 'dispatchResult';
  readonly version: 1;
  readonly dispatchId: number;
  readonly cancelled: boolean;
}

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HostError('invalidEvent', 'Native event field must be an object');
  }
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== fields.length || fields.some(key => !(key in result))) {
    throw new HostError('invalidEvent', 'Native event fields do not match the protocol');
  }
  return result;
}

export function parseNativeEvent(value: unknown): NativeEventPacket {
  const event = record(value, ['kind', 'version', 'dispatchId', 'eventType', 'path', 'cancelable', 'bubbles', 'timestamp', 'sceneSequence']);
  if (
    event.kind !== 'event' || event.version !== 1 || event.eventType !== 'click' ||
    !Number.isSafeInteger(event.dispatchId) || (event.dispatchId as number) < 1 ||
    !Number.isSafeInteger(event.sceneSequence) || (event.sceneSequence as number) < 1 ||
    typeof event.cancelable !== 'boolean' || typeof event.bubbles !== 'boolean' ||
    typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp) || event.timestamp < 0 ||
    !Array.isArray(event.path) || event.path.length === 0 || event.path.length > 4096
  ) {
    throw new HostError('invalidEvent', 'Native event identity or payload is invalid');
  }
  for (const value of event.path) {
    const source = record(value, ['owner', 'source']);
    const owner = record(source.owner, ['id', 'generation']);
    if (
      typeof owner.id !== 'string' || owner.id.length === 0 || new TextEncoder().encode(owner.id).length > 256 ||
      !Number.isSafeInteger(owner.generation) || (owner.generation as number) < 1 ||
      !Number.isInteger(source.source) || (source.source as number) < 0 || (source.source as number) > 0xffff_ffff
    ) {
      throw new HostError('invalidEvent', 'Native event source is invalid');
    }
  }
  return event as unknown as NativeEventPacket;
}
