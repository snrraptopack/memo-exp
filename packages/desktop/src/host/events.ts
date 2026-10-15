/** Private wire events. Application callbacks retain ordinary DOM JSX types. */
import { HostError, type Operation, type SourceReference } from './protocol';

export type ControlledValue = Extract<Operation, { op: 'setValue' }>;

export interface NativeDispatchResult {
  readonly cancelled: boolean;
  readonly controls?: readonly ControlledValue[];
}

/** Native editor observation, used only to reconcile controlled values. */
export interface NativeControlState {
  readonly value: string;
  readonly revision: number;
  readonly isComposing: boolean;
  readonly checked?: boolean;
}

export interface NativeKeyboardState {
  readonly key: string;
  readonly code: string;
  readonly location: number;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export const nativeEventNames = {
  click: 'onClick',
  input: 'onInput',
  keydown: 'onKeyDown',
  keyup: 'onKeyUp',
} as const;

export function supportsNativeEvent(name: string): boolean {
  return Object.values(nativeEventNames).some(event => name === event || name === event + 'Capture');
}

export interface NativeEventPacket {
  readonly kind: 'event';
  readonly version: 1;
  readonly dispatchId: number;
  readonly eventType: keyof typeof nativeEventNames;
  readonly path: readonly SourceReference[];
  readonly cancelable: boolean;
  readonly bubbles: boolean;
  readonly timestamp: number;
  readonly sceneSequence: number;
  readonly control?: NativeControlState;
  readonly keyboard?: NativeKeyboardState;
}

export interface DispatchDecision {
  readonly kind: 'dispatchResult';
  readonly version: 1;
  readonly dispatchId: number;
  readonly cancelled: boolean;
  readonly controls?: readonly ControlledValue[];
}

function record(value: unknown, fields: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HostError('invalidEvent', 'Native event field must be an object');
  }
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !fields.includes(key) && !optional.includes(key)) ||
      fields.some(key => !Object.hasOwn(result, key))) {
    throw new HostError('invalidEvent', 'Native event fields do not match the protocol');
  }
  return result;
}

export function parseNativeEvent(value: unknown): NativeEventPacket {
  const event = record(value, ['kind', 'version', 'dispatchId', 'eventType', 'path', 'cancelable', 'bubbles', 'timestamp', 'sceneSequence'], ['control', 'keyboard']);
  if (
    event.kind !== 'event' || event.version !== 1 ||
    typeof event.eventType !== 'string' || !Object.hasOwn(nativeEventNames, event.eventType) ||
    !Number.isSafeInteger(event.dispatchId) || (event.dispatchId as number) < 1 ||
    !Number.isSafeInteger(event.sceneSequence) || (event.sceneSequence as number) < 1 ||
    typeof event.cancelable !== 'boolean' || typeof event.bubbles !== 'boolean' ||
    typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp) || event.timestamp < 0 ||
    !Array.isArray(event.path) || event.path.length === 0 || event.path.length > 4096
  ) {
    throw new HostError('invalidEvent', 'Native event identity or payload is invalid');
  }
  if (event.control !== undefined) {
    const control = record(event.control, ['value', 'revision', 'isComposing'], ['checked']);
    if (typeof control.value !== 'string' || !Number.isSafeInteger(control.revision) ||
        (control.revision as number) < 0 || typeof control.isComposing !== 'boolean' ||
        control.checked !== undefined && typeof control.checked !== 'boolean') {
      throw new HostError('invalidEvent', 'Native control observation is invalid');
    }
  }
  const keyboard = event.eventType === 'keydown' || event.eventType === 'keyup';
  if (keyboard !== (event.keyboard !== undefined) ||
      event.eventType === 'input' && (event.control === undefined || event.cancelable !== false)) {
    throw new HostError('invalidEvent', 'Native event payload does not match its type');
  }
  if (keyboard) {
    const keys = record(event.keyboard, ['key', 'code', 'location', 'repeat', 'isComposing', 'altKey', 'ctrlKey', 'metaKey', 'shiftKey']);
    if (typeof keys.key !== 'string' || typeof keys.code !== 'string' ||
        !Number.isInteger(keys.location) || (keys.location as number) < 0 || (keys.location as number) > 3 ||
        ['repeat', 'isComposing', 'altKey', 'ctrlKey', 'metaKey', 'shiftKey'].some(key => typeof keys[key] !== 'boolean')) {
      throw new HostError('invalidEvent', 'Native keyboard observation is invalid');
    }
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
