import { writeFileSync } from 'node:fs';
import { connectNativeHost as connect } from '../../src/host/node-process';
import type { NativeProcessOptions } from '../../src/host/transport';

/** Verify that selecting a backend really replaces the emitted host module. */
export function connectNativeHost(options: NativeProcessOptions) {
  const probe = process.env.MEMOIZED_CUSTOM_ADAPTER_PROBE;
  if (!probe) throw new Error('Custom adapter probe was not supplied');
  writeFileSync(probe, 'custom adapter selected');
  return connect(options);
}
