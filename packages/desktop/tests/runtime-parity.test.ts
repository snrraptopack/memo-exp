import { expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileDesktop } from '@memoized-dom/compiler/desktop';
import {
  createDesktopApplication,
  type DesktopHost,
  type SceneInstance,
  type SceneTransaction,
} from '../src';

let nextModule = 0;
async function load(source: string) {
  const compiled = compileDesktop(source, {
    moduleId: `parity-${nextModule++}.tsx`,
    runtimePath: pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
  ) as Promise<{
    Counter(): SceneInstance;
    increment(): number;
    read(): readonly unknown[];
  }>;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

/** Record accepted values, and independently control host acceptance. */
function host() {
  const transactions: SceneTransaction[] = [];
  const values = new Map<number, Map<number, string>>();
  let rejection = false;
  let gate: ReturnType<typeof deferred> | undefined;
  const native: DesktopHost = {
    async install() {},
    async commit(transaction) {
      const pending = gate;
      gate = undefined;
      await pending?.promise;
      if (rejection) {
        rejection = false;
        throw new Error('native rejection');
      }
      transactions.push(transaction);
      for (const operation of transaction.operations) {
        if (operation.kind === 'mount') values.set(operation.handle.id, new Map());
        if (operation.kind === 'mount' || operation.kind === 'update') {
          for (const write of operation.values)
            values.get(operation.handle.id)!.set(write.slot, write.value);
        } else if (operation.kind === 'dispose') values.delete(operation.handle.id);
      }
      return { sequence: transaction.sequence };
    },
  };
  return {
    app: createDesktopApplication(native),
    transactions,
    values,
    text(owner: SceneInstance, slot = 0) {
      return values.get(owner.handle.id)?.get(slot);
    },
    reject() {
      rejection = true;
    },
    block() {
      gate = deferred();
      return gate;
    },
  };
}

it.each([
  `const value = count + 1;`,
  `function calculate() {
    return count + 1;
  }

  const value = calculate();`,
])('replays setup derivations after a local write: %s', async (setup) => {
  const module = await load(
    `export function Counter() {
      let count = 0;
      ${setup}

      return <button onClick={() => count++}>{value}</button>;
    }`,
  );
  const f = host();
  try {
    const owner = f.app.mount(module.Counter);
    await owner.ready;
    expect(f.text(owner)).toBe('1');
    await owner.dispatch(0);
    expect(f.text(owner)).toBe('2');
  } finally {
    await f.app.dispose();
  }
});

it('runs effects of derived locals only when the calculated value changes', async () => {
  const observations: number[] = [];
  Object.assign(globalThis, {
    desktopParityRecord: (value: number) => {
      observations.push(value);
    },
  });
  const module = await load(`
    export function Counter() {
      let count = 0;
      const parity = count % 2;

      $effect(() => { globalThis.desktopParityRecord(parity); });

      return <main>
        <button onClick={() => count += 2}>Two</button>
        <button onClick={() => count++}>One</button>
        <p>{parity}</p>
      </main>;
    }
  `);
  const f = host();
  try {
    const owner = f.app.mount(module.Counter);
    await owner.ready;
    await f.app.flush();
    expect(observations).toEqual([0]);

    await owner.dispatch(0);
    expect(observations).toEqual([0]);

    await owner.dispatch(1);
    expect(observations).toEqual([0, 1]);
  } finally {
    await f.app.dispose();
    Reflect.deleteProperty(globalThis, 'desktopParityRecord');
  }
});

it('cancels rejected candidates with setup cleanup and no ref or effect activation', async () => {
  const observations: string[] = [];
  Object.assign(globalThis, {
    desktopParityRecord: (value: string) => {
      observations.push(value);
    },
    desktopParityRef: () => {
      observations.push('ref');
    },
  });
  const module = await load(`
    function Child() {
      const receiveRef = globalThis.desktopParityRef;
      $cleanup(() => globalThis.desktopParityRecord('setup cleanup'));
      $effect(() => { globalThis.desktopParityRecord('effect'); });
      return <p ref={receiveRef}>Candidate</p>;
    }

    export function Counter() {
      let visible = false;
      return <main>
        <button onClick={() => visible = !visible}>Toggle</button>
        {visible ? <Child/> : null}
      </main>;
    }
  `);
  const f = host();
  try {
    const owner = f.app.mount(module.Counter);
    await owner.ready;
    f.reject();
    await expect(owner.dispatch(0)).rejects.toThrow('native rejection');
    expect(observations).toEqual([]);

    await owner.dispatch(0);
    expect(observations).toEqual(['setup cleanup']);
    expect(f.values.size).toBe(1);
  } finally {
    await f.app.dispose();
    Reflect.deleteProperty(globalThis, 'desktopParityRecord');
    Reflect.deleteProperty(globalThis, 'desktopParityRef');
  }
});

it('owns module effects and their teardown separately in each app', async () => {
  const observations: string[] = [];
  Object.assign(globalThis, {
    desktopParityRecord: (value: string) => {
      observations.push(value);
    },
  });
  const module = await load(`
    let count = 0;

    $effect(() => {
      globalThis.desktopParityRecord('effect:' + count);
      return () => globalThis.desktopParityRecord('cleanup:' + count);
    });

    export function increment() { return ++count; }
    export function Counter() { return <p>{count}</p>; }
  `);
  const first = host();
  const second = host();
  try {
    const a = first.app.mount(module.Counter);
    const b = second.app.mount(module.Counter);
    await Promise.all([a.ready, b.ready]);
    await Promise.all([first.app.flush(), second.app.flush()]);
    expect(observations).toEqual(['effect:0', 'effect:0']);

    first.app.run(module.increment);
    await first.app.flush();
    expect(observations).toEqual(['effect:0', 'effect:0', 'cleanup:1', 'effect:1']);
    expect(second.text(b)).toBe('0');

    await first.app.dispose();
    expect(observations.at(-1)).toBe('cleanup:1');
    second.app.run(module.increment);
    await second.app.flush();
    expect(second.text(b)).toBe('1');
    expect(observations.slice(-2)).toEqual(['cleanup:1', 'effect:1']);
  } finally {
    await Promise.all([first.app.dispose(), second.app.dispose()]);
    Reflect.deleteProperty(globalThis, 'desktopParityRecord');
  }
});

it('surfaces teardown failures after disposing every owner', async () => {
  const observations: string[] = [];
  Object.assign(globalThis, {
    desktopParityRecord: (value: string) => {
      observations.push(value);
    },
  });
  const module = await load(`
    export function Counter() {
      $cleanup(() => globalThis.desktopParityRecord('last'));
      $cleanup(() => { throw new Error('cleanup failure'); });
      return <p>Cleanup</p>;
    }
  `);
  const f = host();
  try {
    const first = f.app.mount(module.Counter);
    const second = f.app.mount(module.Counter);
    await Promise.all([first.ready, second.ready]);
    await expect(f.app.dispose()).rejects.toThrow();
    expect(observations).toEqual(['last', 'last']);
    expect(f.values.size).toBe(0);
  } finally {
    await f.app.dispose();
    Reflect.deleteProperty(globalThis, 'desktopParityRecord');
  }
});

it('replays local and module control flow and resets inactive partial assignments', async () => {
  const module = await load(`
    let total = 0;
    let description;
    if (total > 0) {
      description = 'positive';
    } else {
      description = undefined;
    }

    export function Counter() {
      let count = 0;
      let label = '';

      if (count > 0) label = 'local';

      return <main>
        <button onClick={() => { count++; total++; }}>Up</button>
        <button onClick={() => { count = 0; total = 0; }}>Reset</button>
        <p>{label}</p>
        <p>{description}</p>
      </main>;
    }
  `);
  const f = host();
  try {
    const owner = f.app.mount(module.Counter);
    await owner.ready;
    await owner.dispatch(0);
    expect(f.text(owner, 0)).toBe('local');
    expect(f.text(owner, 1)).toBe('positive');
    await owner.dispatch(1);
    expect(f.text(owner, 0)).toBe('');
    expect(f.text(owner, 1)).toBe('');
  } finally {
    await f.app.dispose();
  }
});

it('isolates mutable stores and derived cells when the SAME loaded module mounts in two apps', async () => {
  const module = await load(`
    let count = 0;
    const model = { name: 'Ada' };
    const doubled = count * 2;

    export function increment() {
      model.name = 'Grace';
      return ++count;
    }

    export function read() {
      return [count, doubled, model.name];
    }

    export function Counter() {
      return <main><p>{count}</p><p>{doubled}</p><p>{model.name}</p></main>;
    }
  `);
  const first = host();
  const second = host();
  try {
    const a = first.app.mount(module.Counter);
    const b = second.app.mount(module.Counter);
    await Promise.all([a.ready, b.ready]);
    expect(first.app.run(module.increment)).toBe(1);
    await first.app.flush();
    expect(first.app.run(module.read)).toEqual([1, 2, 'Grace']);
    expect(second.app.run(module.read)).toEqual([0, 0, 'Ada']);
    expect(first.text(a, 1)).toBe('2');
    expect(second.text(b, 1)).toBe('0');
    await first.app.dispose();
    expect(second.app.run(module.increment)).toBe(1);
    await second.app.flush();
    expect(second.text(b, 1)).toBe('2');
  } finally {
    await Promise.all([first.app.dispose(), second.app.dispose()]);
  }
});

it('publishes each async segment before completion and preserves rejected finalizer writes', async () => {
  const pause = deferred();
  Object.assign(globalThis, { desktopParityPause: pause.promise });
  const module = await load(`export function Counter() {
    let count = 0;
    const doubled = count * 2;

    return <button onClick={async () => {
      try {
        count++;
        await globalThis.desktopParityPause;
        throw new Error('authored rejection');
      } finally {
        count++;
      }
    }}>{count}:{doubled}</button>;
  }`);
  const f = host();
  try {
    const owner = f.app.mount(module.Counter);
    await owner.ready;
    const completion = owner.dispatch(0).then(
      () => null,
      (error) => error,
    );
    await f.app.flush();
    expect(f.text(owner, 0)).toBe('1');
    expect(f.text(owner, 1)).toBe('2');
    pause.resolve();
    expect((await completion).message).toBe('authored rejection');
    expect(f.text(owner, 0)).toBe('2');
    expect(f.text(owner, 1)).toBe('4');
  } finally {
    pause.resolve();
    await f.app.dispose();
    Reflect.deleteProperty(globalThis, 'desktopParityPause');
  }
});

it('lets native events acknowledge while async handlers are suspended', async () => {
  const pause = deferred();
  Object.assign(globalThis, { desktopParityPause: pause.promise });
  const module = await load(
    `export function Counter() {
      let count = 0;

      return <button onClick={async () => {
        count++;
        await globalThis.desktopParityPause;
        count++;
      }}>{count}</button>;
    }`,
  );
  const f = host();
  try {
    const owner = f.app.mount(module.Counter);
    await owner.ready;
    await f.app.dispatchEvent({
      type: 'event',
      handle: owner.handle,
      site: 0,
      payload: { type: 'click' },
    });
    expect(f.text(owner)).toBe('1');
    pause.resolve();
    await Bun.sleep(0);
    await f.app.flush();
    expect(f.text(owner)).toBe('2');
  } finally {
    pause.resolve();
    await f.app.dispose();
    Reflect.deleteProperty(globalThis, 'desktopParityPause');
  }
});

it('publishes retained local timer callbacks without an event boundary', async () => {
  const module = await load(
    `export function Counter() {
      let count = 0;
      const doubled = count * 2;

      setTimeout(() => count++, 0);

      return <p>{doubled}</p>;
    }`,
  );
  const f = host();
  try {
    const owner = f.app.mount(module.Counter);
    await owner.ready;
    await Bun.sleep(5);
    await f.app.flush();
    expect(f.text(owner)).toBe('2');
  } finally {
    await f.app.dispose();
  }
});

it('runs effects after accepted renders, retains cleanup, and blocks rejected render effects', async () => {
  const observations: string[] = [];
  Object.assign(globalThis, {
    desktopParityRecord: (value: string) => {
      observations.push(value);
    },
  });
  const module = await load(`export function Counter() {
    let count = 0;

    $effect(() => {
      globalThis.desktopParityRecord('effect:' + count);
      return () => globalThis.desktopParityRecord('dispose:' + count);
    });

    $cleanup(() => globalThis.desktopParityRecord('owner'));

    return <button onClick={() => count++}>{count}</button>;
  }`);
  const f = host();
  const blocked = f.block();
  try {
    const owner = f.app.mount(module.Counter);
    await Bun.sleep(0);
    expect(observations).toEqual([]);
    blocked.resolve();
    await owner.ready;
    await f.app.flush();
    expect(observations).toEqual(['effect:0']);
    f.reject();
    await expect(owner.dispatch(0)).rejects.toThrow('native rejection');
    expect(observations).toEqual(['effect:0']);
    await owner.flush();
    expect(observations).toEqual(['effect:0', 'dispose:1', 'effect:1']);
    await f.app.dispose();
    expect(observations).toEqual(['effect:0', 'dispose:1', 'effect:1', 'dispose:1', 'owner']);
  } finally {
    blocked.resolve();
    await f.app.dispose();
    Reflect.deleteProperty(globalThis, 'desktopParityRecord');
  }
});

it('supports conditional effect teardown and settles bounded feedback writes', async () => {
  const observations: string[] = [];
  Object.assign(globalThis, {
    desktopParityRecord: (value: string) => {
      observations.push(value);
    },
  });
  const module = await load(`export function Counter() {
    let count = 0;
    let enabled = true;

    $effect(() => {
      if (count < 1) count++;
    });

    if (enabled) $effect(() => {
      globalThis.desktopParityRecord('on');
      return () => globalThis.desktopParityRecord('off');
    });

    return <button onClick={() => enabled = !enabled}>{count}</button>;
  }`);
  const f = host();
  try {
    const owner = f.app.mount(module.Counter);
    await owner.ready;
    await f.app.flush();
    expect(f.text(owner)).toBe('1');
    expect(observations).toEqual(['on']);
    await owner.dispatch(0);
    expect(observations).toEqual(['on', 'off']);
    await owner.dispatch(0);
    expect(observations).toEqual(['on', 'off', 'on']);
  } finally {
    await f.app.dispose();
    Reflect.deleteProperty(globalThis, 'desktopParityRecord');
  }
});

it('mounts refs after acceptance and keeps accepted values and reverse disposal order', async () => {
  const refs: Array<{ node: number; value: string; isConnected: boolean }> = [];
  const disposed: string[] = [];
  Object.assign(globalThis, {
    desktopParityRef: (node: (typeof refs)[number]) => {
      refs.push(node);
      return () => {
        disposed.push('ref');
      };
    },
    desktopParityRecord: (value: string) => {
      disposed.push(value);
    },
  });
  const module = await load(`export function Counter() {
    let input;
    let value = 'first';
    const receiveRef = globalThis.desktopParityRef;

    $cleanup(() => globalThis.desktopParityRecord(input === undefined ? 'cleared' : 'leaked'));

    return <input id="editor" ref={[input, receiveRef]} value={value}
      onChange={event => value = event.target.value}/>;
  }`);
  const f = host();
  const blocked = f.block();
  try {
    const owner = f.app.mount(module.Counter);
    await Bun.sleep(0);
    expect(refs).toHaveLength(0);
    blocked.resolve();
    await owner.ready;
    await f.app.flush();
    expect(refs).toHaveLength(1);
    expect(refs[0]!.isConnected).toBe(true);
    expect(refs[0]!.value).toBe('first');
    f.reject();
    await expect(owner.dispatch(0, { target: { value: 'second' } })).rejects.toThrow(
      'native rejection',
    );
    expect(refs[0]!.value).toBe('first');
    await owner.flush();
    expect(refs[0]!.value).toBe('second');
    expect(refs).toHaveLength(1);
    await f.app.dispose();
    expect(refs[0]!.isConnected).toBe(false);
    expect(disposed).toEqual(['ref', 'cleared']);
  } finally {
    blocked.resolve();
    await f.app.dispose();
    Reflect.deleteProperty(globalThis, 'desktopParityRef');
    Reflect.deleteProperty(globalThis, 'desktopParityRecord');
  }
});
