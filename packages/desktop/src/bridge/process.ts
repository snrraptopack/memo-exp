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
  let closing = false;
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
    failure = error;
    rejectReady(error);
    resolveClosed();
    for (const request of pending.values()) request.reject(error);
    pending.clear();
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
        const response = JSON.parse(line) as { id: number; result?: unknown; error?: string; type?: string };
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
  const stderr = new Response(child.stderr).text();
  void child.exited.then(async code => {
    await output;
    resolveClosed();
    if ((!closed && !closing) || code !== 0 || pending.size) {
      fail(new Error(`Desktop host exited (${code}): ${(await stderr).trim()}`));
    }
  });
  const request = (command: object): Promise<unknown> => {
    if (failure) return Promise.reject(failure);
    if (closed) return Promise.reject(new Error('Desktop host is closed'));
    const id = nextId++;
    return new Promise((resolveRequest, reject) => {
      pending.set(id, { resolve: resolveRequest, reject });
      try {
        child.stdin.write(`${JSON.stringify({ id, version: 1, ...command })}\n`);
        child.stdin.flush();
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
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
    async close() {
      if (closed) return;
      closing = true;
      if (child.exitCode !== null) {
        closed = true;
        await output;
        if (child.exitCode !== 0) throw failure ?? new Error(`Desktop host exited (${child.exitCode})`);
        return;
      }
      let shutdownError: unknown;
      try { await request({ kind: 'shutdown' }); }
      catch (error) { shutdownError = error; }
      finally {
        closed = true;
        child.stdin.end();
      }
      const code = await child.exited;
      await output;
      if (shutdownError !== undefined) throw shutdownError;
      if (code !== 0) throw failure ?? new Error(`Desktop host exited (${code})`);
    },
  };
}
