import type { DesktopHost, NativeSceneEvent, SceneAcknowledgment, SceneSnapshot, SceneTemplate, SceneTransaction } from './protocol';

export interface DesktopProcessHost extends DesktopHost {
  readonly ready: Promise<void>;
  readonly windowClosed: Promise<void>;
  onEvent(listener: (event: NativeSceneEvent) => void): () => void;
  acknowledgeEvent(event: NativeSceneEvent): Promise<void>;
  /** Debug builds only; invokes the native platform input handler in window tests. */
  testInput(handle: NativeSceneEvent['handle'], node: number, action: 'insert' | 'compose' | 'commit' | 'backspace' | 'select-all', text?: string): Promise<void>;
  inspect(): Promise<SceneSnapshot>;
  redraw(): Promise<void>;
  close(): Promise<void>;
}

/** Bun owns authored behavior; the child Rust process owns the retained scene. */
export function createProcessHost(options: { executable: string; args?: readonly string[]; window?: boolean }): DesktopProcessHost {
  const child = Bun.spawn([options.executable, ...(options.args ?? [])], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', windowsHide: !options.window });
  let nextId = 1;
  let closed = false;
  let closing: Promise<void> | undefined;
  let failure: Error | undefined;
  const listeners = new Set<(event: NativeSceneEvent) => void>();
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void ready.catch(() => {});
  if (!options.window) resolveReady();
  let resolveClosed!: () => void;
  const windowClosed = new Promise<void>(resolve => { resolveClosed = resolve; });
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const fail = (error: Error): void => {
    if (failure) return;
    failure = error;
    rejectReady(error);
    resolveClosed();
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    // A broken stream cannot safely publish again. Retire the process as well
    // as its promises, including hosts that no longer respond to shutdown.
    if (child.exitCode === null) {
      try { child.kill('SIGKILL'); } catch {}
    }
  };
  const output = (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of child.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const response = decodeResponse(line);
        if (response.type === 'ready') { resolveReady(); continue; }
        if (response.type === 'closed') { resolveClosed(); continue; }
        if (response.type === 'event') {
          const event = response as unknown as NativeSceneEvent;
          if (!Number.isSafeInteger(event.handle?.id) || event.handle.id <= 0 ||
              !Number.isSafeInteger(event.handle?.generation) || event.handle.generation <= 0 ||
              !Number.isSafeInteger(event.site) || event.site < 0) throw new Error('Invalid native desktop event');
          if (event.edit !== undefined && (!Number.isSafeInteger(event.edit) || event.edit <= 0)) throw new Error('Invalid native input edit');
          for (const listener of listeners) listener(event);
          continue;
        }
        const request = pending.get(response.id);
        if (!request) throw new Error('Unknown desktop host response');
        pending.delete(response.id);
        if (response.error !== undefined) request.reject(new Error(response.error));
        else request.resolve(response.result);
      }
    }
    if (buffer.trim()) throw new Error('Incomplete desktop host response');
  })().catch(error => { fail(error instanceof Error ? error : new Error(String(error))); });
  // Drain stderr continuously without retaining every line for the lifetime of
  // the application. The tail preserves useful crash diagnostics.
  let diagnostics = '';
  const stderr = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of child.stderr) {
      diagnostics = (diagnostics + decoder.decode(chunk, { stream: true })).slice(-16_384);
    }
    diagnostics = (diagnostics + decoder.decode()).slice(-16_384);
  })().catch(error => { fail(error instanceof Error ? error : new Error(String(error))); });
  void child.exited.then(async code => {
    await output;
    await stderr;
    resolveClosed();
    if ((!closed && !closing) || code !== 0 || pending.size) {
      fail(new Error(`Desktop host exited (${code}): ${diagnostics.trim()}`));
    }
  });
  const request = (command: object, shutdown = false): Promise<unknown> => {
    if (failure) return Promise.reject(failure);
    if (closed) return Promise.reject(new Error('Desktop host is closed'));
    if (closing && !shutdown) return Promise.reject(new Error('Desktop host is closing'));
    const id = nextId++;
    let line: string;
    try { line = `${JSON.stringify({ id, version: 1, ...command })}\n`; }
    catch (error) { return Promise.reject(error); }
    return new Promise((resolveRequest, reject) => {
      pending.set(id, { resolve: resolveRequest, reject });
      try {
        child.stdin.write(line);
        const flushed = child.stdin.flush();
        if (flushed instanceof Promise) void flushed.catch(error => { fail(error instanceof Error ? error : new Error(String(error))); });
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };
  return {
    ready, windowClosed,
    onEvent(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async acknowledgeEvent(event) {
      if (event.edit !== undefined) await request({ kind: 'acknowledge', handle: event.handle, site: event.site, edit: event.edit });
    },
    async testInput(handle, node, action, text) { await request({ kind: 'test_input', handle, node, action, text }); },
    async install(template: SceneTemplate) { await request({ kind: 'install', template }); },
    async commit(transaction: SceneTransaction) { return await request({ kind: 'apply', transaction }) as SceneAcknowledgment; },
    async inspect() { return await request({ kind: 'inspect' }) as SceneSnapshot; },
    async redraw() { await request({ kind: 'redraw' }); },
    close() {
      if (!closing) {
        closing = (async () => {
          let shutdownError: unknown;
          if (child.exitCode === null) {
            try { await request({ kind: 'shutdown' }, true); }
            catch (error) { shutdownError = error; }
            finally { try { child.stdin.end(); } catch {} }
          }
          const code = await child.exited;
          await output;
          await stderr;
          if (failure) throw failure;
          if (shutdownError !== undefined) throw shutdownError;
          if (code !== 0) throw new Error(`Desktop host exited (${code}): ${diagnostics.trim()}`);
        })().finally(() => { closed = true; });
        void closing.catch(() => {});
      }
      return closing;
    },
  };
}

type HostResponse =
  | { type: 'ready' }
  | { type: 'closed' }
  | NativeSceneEvent
  | { type?: never; id: number; result?: unknown; error?: string };

/** Check framing before resolving requests; missing results are not success. */
function decodeResponse(line: string): HostResponse {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid desktop host response');
  const response = value as Record<string, unknown>;
  if (response.type === 'ready' || response.type === 'closed' || response.type === 'event') return value as HostResponse;
  const result = Object.hasOwn(response, 'result');
  const error = Object.hasOwn(response, 'error');
  if (response.type !== undefined || !Number.isSafeInteger(response.id) || (response.id as number) <= 0 ||
      result === error || (error && typeof response.error !== 'string')) throw new Error('Invalid desktop host response');
  return value as HostResponse;
}
