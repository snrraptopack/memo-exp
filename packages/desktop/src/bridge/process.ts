import type { DesktopHost, SceneAcknowledgment, SceneSnapshot, SceneTemplate, SceneTransaction } from './protocol';

export interface DesktopProcessHost extends DesktopHost {
  inspect(): Promise<SceneSnapshot>;
  close(): Promise<void>;
}

/** Bun owns authored behavior; the child Rust process owns the retained scene. */
export function createProcessHost(options: { executable: string }): DesktopProcessHost {
  const child = Bun.spawn([options.executable], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  let nextId = 1;
  let closed = false;
  let failure: Error | undefined;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const fail = (error: Error): void => {
    failure = error;
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
        const response = JSON.parse(line) as { id: number; result?: unknown; error?: string };
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
    if (!closed || code !== 0 || pending.size) {
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
    async install(template: SceneTemplate) { await request({ kind: 'install', template }); },
    async commit(transaction: SceneTransaction) { return await request({ kind: 'apply', transaction }) as SceneAcknowledgment; },
    async inspect() { return await request({ kind: 'inspect' }) as SceneSnapshot; },
    async close() {
      if (closed) return;
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
