import { spawn } from 'node:child_process';
import { FrameDecoder, encodeFrame } from './framing';
import { HostError } from './protocol';
import type { NativeProcessOptions, PublicationTransport, TransportObserver } from './transport';

/** Shared Node-compatible adapter: works under Bun and Node, with no Bun APIs. */
export function connectNativeHost(options: NativeProcessOptions): PublicationTransport {
  const child = spawn(options.executable, [...(options.args ?? [])], {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let observer: TransportObserver | undefined;
  let terminal: Error | undefined;
  let disposed = false;
  let diagnostics = '';
  const writes = new Set<(error: Error) => void>();

  function terminate(error: Error): void {
    if (terminal) return;
    terminal = error;
    for (const reject of writes) reject(error);
    writes.clear();
    try {
      observer?.failure(error);
    } finally {
      dispose();
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    child.kill();
    const error = terminal ?? new HostError('closed', 'Native process was disposed');
    for (const reject of writes) reject(error);
    writes.clear();
  }

  const decoder = new FrameDecoder(value => {
    if (!observer) throw new HostError('unexpectedReply', 'Native reply arrived before connection setup');
    observer.reply(value);
  });
  child.stdout.on('data', (chunk: Buffer) => {
    if (disposed) return;
    try {
      decoder.push(chunk);
    } catch (error) {
      terminate(error instanceof Error ? error : new HostError('invalidFrame', String(error)));
    }
  });
  child.stdout.on('end', () => {
    if (disposed) return;
    try {
      decoder.end();
      terminate(new HostError('hostClosed', 'Native host closed its reply stream'));
    } catch (error) {
      terminate(error instanceof Error ? error : new HostError('invalidFrame', String(error)));
    }
  });
  child.stdout.on('error', terminate);
  child.stdin.on('error', terminate);
  child.stderr.on('error', terminate);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (text: string) => {
    // Drain continuously, retaining only a bounded diagnostic tail.
    diagnostics = (diagnostics + text).slice(-2048);
  });
  child.on('error', terminate);
  child.on('close', (code, signal) => {
    if (!disposed) {
      terminate(new HostError(
        'hostExited',
        'Native host exited (' + String(code ?? signal) + '): ' + diagnostics.trim(),
      ));
    }
  });

  return {
    send(json) {
      if (disposed || terminal) {
        return Promise.reject(terminal ?? new HostError('closed', 'Native host closed'));
      }
      if (writes.size !== 0) {
        return Promise.reject(new HostError('writeInProgress', 'Native transport already has an active write'));
      }
      let frame: Uint8Array;
      try {
        frame = encodeFrame(json);
      } catch (error) {
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => {
        writes.add(reject);
        child.stdin.write(frame, error => {
          writes.delete(reject);
          if (terminal || disposed) {
            reject(terminal ?? new HostError('closed', 'Native host closed'));
          } else if (error) {
            reject(error);
            terminate(error);
          } else {
            resolve();
          }
        });
      });
    },
    listen(next) {
      if (observer) throw new HostError('alreadyConnected', 'Native transport already has a client');
      observer = next;
      if (terminal) {
        next.failure(terminal);
      } else if (disposed) {
        next.failure(new HostError('closed', 'Native process was disposed'));
      }
      return () => {
        if (observer === next) observer = undefined;
      };
    },
    scheduleDeadline(milliseconds, callback) {
      const timer = setTimeout(callback, milliseconds);
      return () => clearTimeout(timer);
    },
    dispose,
  };
}
