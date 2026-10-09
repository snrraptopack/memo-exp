import { describe, expect, it } from 'bun:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { compileDesktop } from '@memoized-dom/compiler/desktop';
import { createDesktopApplication, type DesktopHost, type SceneInstance, type SceneTemplate,
  type SceneTransaction } from '../src';

const runtimePath = pathToFileURL(resolve(import.meta.dirname, '../src/index.ts')).href;
async function load(source: string): Promise<{ Counter(): SceneInstance }> {
  const compiled = compileDesktop(source, { moduleId: 'counter.tsx', runtimePath });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
}

function recordingHost() {
  const transactions: SceneTransaction[] = [];
  const templates: SceneTemplate[] = [];
  let rejectNext = false;
  const host: DesktopHost = {
    async install(template) { templates.push(template); },
    async commit(transaction) {
      if (rejectNext) { rejectNext = false; throw new Error('publication rejected'); }
      transactions.push(transaction);
      return { sequence: transaction.sequence };
    },
  };
  return { host, transactions, templates, reject() { rejectNext = true; } };
}

describe('desktop compilation and publication', () => {
  it('publishes native input values and dependent text from the authored change callback', async () => {
    const { Counter } = await load(`export function Counter(){ let value = ''; return <div><input type="text" value={value} onChange={e => value = e.target.value}/><p>{value}</p></div>; }`);
    const recording = recordingHost(); const app = createDesktopApplication(recording.host); const root = app.mount(Counter); await root.ready;
    const template = recording.templates[0]!;
    expect(template.slots.map(slot => slot.type)).toEqual(['value', 'text']);
    expect(template.events).toEqual([{ node: 1, type: 'change' }]);
    await root.dispatch(0, { target: { value: '静🙂café' }, currentTarget: { value: '静🙂café' } });
    expect(recording.transactions.at(-1)!.operations[0]).toMatchObject({ kind: 'update', values: [{ slot: 0, value: '静🙂café' }, { slot: 1, value: '静🙂café' }] });
    await app.dispose();
  });
  it('keeps ordinary CSS imports and static style objects in native template definitions', async () => {
    const source = `import './app.css'; export function Counter(){ return <p id="title" className="label" aria-label="A title" style={{paddingTop: 12, lineHeight: 1.5, color: 'red'}}>Hi</p>; }`;
    const output = compileDesktop(source, { moduleId: 'styles.tsx', runtimePath, readStylesheet: () => '.label { color: blue; }' });
    const compiled = await import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`) as { Counter(): SceneInstance };
    const recording = recordingHost(); const app = createDesktopApplication(recording.host); const root = app.mount(compiled.Counter); await root.ready;
    expect(recording.templates[0]!.nodes[0]).toMatchObject({ attributes: { id: 'title', class: 'label', 'aria-label': 'A title' }, style: [{ property: 'padding-top', value: '12px' }, { property: 'line-height', value: '1.5' }, { property: 'color', value: 'red' }] });
    expect(recording.templates[0]!.stylesheets).toHaveLength(1); await app.dispose();
  });

  it('reuses scoped TSRX CSS processing and preserves scope selectors', async () => {
    const output = compileDesktop(`export function Counter(){ return <div class="outer"><p class="inner">Hi</p><style>.outer .inner { color: red; }</style></div>; }`, { moduleId: 'scoped.tsrx', runtimePath });
    const compiled = await import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`) as { Counter(): SceneInstance };
    const recording = recordingHost(); const app = createDesktopApplication(recording.host); const root = app.mount(compiled.Counter); await root.ready;
    const template = recording.templates[0]!;
    expect(template.nodes[0]).toMatchObject({ attributes: { class: expect.stringContaining('tsrx-') } });
    expect(template.stylesheets![0]!.selectors[0]).toHaveLength(2);
    expect(template.stylesheets![0]!.declarations[0]).toEqual({ property: 'color', value: 'red' }); await app.dispose();
  });
  it('compiles local state into one template and preserves scene identity across updates', async () => {
    const { Counter } = await load(`export function Counter() {
      let count: number = 0;
      return <button onClick={() => count++}>Count: {count}</button>;
    }`);
    const recording = recordingHost();
    const app = createDesktopApplication(recording.host);
    const counter = app.mount(Counter);
    await counter.ready;
    expect(recording.templates[0]!.nodes).toMatchObject([
      { kind: 'element', tag: 'button' }, { kind: 'text' }, { kind: 'text' },
    ]);
    expect(recording.transactions[0]!.operations[0]).toMatchObject({ kind: 'mount', values: [{ slot: 0, value: '0' }] });
    expect(await counter.dispatch(0)).toBe(0); // Authored postfix return is preserved.
    await counter.dispatch(0);
    expect(recording.transactions.at(-1)!.operations[0]).toEqual({ kind: 'update', handle: counter.handle, values: [{ slot: 0, value: '2' }] });
    expect(recording.transactions.filter(transaction => transaction.operations[0]!.kind === 'mount')).toHaveLength(1);
    await counter.dispose();
    await counter.dispose();
    expect(recording.transactions.filter(transaction => transaction.operations[0]!.kind === 'dispose')).toHaveLength(1);
    await expect(counter.dispatch(0)).rejects.toThrow('disposed owner');
  });

  it('keeps instances and application scopes independent', async () => {
    const { Counter } = await load(`export const Counter = () => {
      let count = 0;
      return <button onClick={() => ++count}>{count}</button>;
    };`);
    const first = recordingHost();
    const second = recordingHost();
    const app = createDesktopApplication(first.host);
    const other = createDesktopApplication(second.host);
    const a = app.mount(Counter);
    const b = app.mount(Counter);
    const c = other.mount(Counter);
    await Promise.all([a.ready, b.ready, c.ready]);
    expect(first.templates).toHaveLength(1);
    expect(second.templates).toHaveLength(1);
    await a.dispatch(0);
    expect(first.transactions.at(-1)!.operations[0]!.handle).toEqual(a.handle);
    expect(second.transactions).toHaveLength(1);
    expect(first.transactions.filter(transaction => transaction.operations[0]!.kind === 'update')).toHaveLength(1);
    await app.dispose();
    await other.dispose();
    expect(() => Counter()).toThrow('application.mount');
  });

  it('retries rejected text publication without advancing accepted-value caches', async () => {
    const { Counter } = await load(`export function Counter() {
      let count = 0;
      return <button onClick={() => count++}>{count}</button>;
    }`);
    const recording = recordingHost();
    const counter = createDesktopApplication(recording.host).mount(Counter);
    await counter.ready;
    recording.reject();
    await expect(counter.dispatch(0)).rejects.toThrow('publication rejected');
    expect(recording.transactions).toHaveLength(1);
    await counter.flush();
    expect(recording.transactions[1]).toMatchObject({ sequence: 2, operations: [{ values: [{ slot: 0, value: '1' }] }] });
    await counter.dispose();
  });

  it('retries rejected disposal and still disposes other owners', async () => {
    const { Counter } = await load(`export function Counter() {
      let count = 0;
      return <button onClick={() => count++}>{count}</button>;
    }`);
    const recording = recordingHost();
    const app = createDesktopApplication(recording.host);
    const first = app.mount(Counter);
    const second = app.mount(Counter);
    await Promise.all([first.ready, second.ready]);
    recording.reject();
    await expect(app.dispose()).rejects.toThrow('disposal failed');
    expect(recording.transactions.at(-1)!.operations[0]).toMatchObject({ kind: 'dispose', handle: second.handle });
    await app.dispose();
    expect(recording.transactions.at(-1)!.operations[0]).toMatchObject({ kind: 'dispose', handle: first.handle });
    await expect(first.dispatch(0)).rejects.toThrow('disposed owner');
  });

  it('keeps hidden getter reads conservative', async () => {
    const { Counter } = await load(`export function Counter() {
      let count = 0;
      const hidden = { get label() { return count; } };
      return <button onClick={() => count++}>{hidden.label}</button>;
    }`);
    const recording = recordingHost();
    const counter = createDesktopApplication(recording.host).mount(Counter);
    await counter.ready;
    await counter.dispatch(0);
    expect(recording.transactions.at(-1)!.operations[0]).toMatchObject({ values: [{ slot: 0, value: '1' }] });
    await counter.dispose();
  });

  it('evaluates every affected slot before publishing any changes', async () => {
    const { Counter } = await load(`export function Counter() {
      let count = 0;
      function checked() { if (count === 1) throw new Error('bad read'); return count; }
      return <button onClick={() => count++}>{count}:{checked()}</button>;
    }`);
    const recording = recordingHost();
    const counter = createDesktopApplication(recording.host).mount(Counter);
    await counter.ready;
    await expect(counter.dispatch(0)).rejects.toThrow('bad read');
    expect(recording.transactions).toHaveLength(1);
    await counter.dispatch(0);
    expect(recording.transactions[1]!.operations[0]).toMatchObject({ values: [{ slot: 0, value: '2' }, { slot: 1, value: '2' }] });
    await counter.dispose();
  });

  it('preserves writes before a callback exception and named helper closures', async () => {
    const { Counter } = await load(`export function Counter() {
      let count = 0;
      function increment() { count++; throw new Error('authored failure'); }
      return <button onClick={increment}>{count}</button>;
    }`);
    const recording = recordingHost();
    const counter = createDesktopApplication(recording.host).mount(Counter);
    await counter.ready;
    await expect(counter.dispatch(0)).rejects.toThrow('authored failure');
    expect(recording.transactions[1]!.operations[0]).toMatchObject({ values: [{ slot: 0, value: '1' }] });
    await counter.dispose();
  });

  it('publishes only slots affected by the event write', async () => {
    const { Counter } = await load(`export function Counter() {
      let count = 0;
      let other = 0;
      return <container><button onClick={() => count++}>{count}</button><button onClick={() => other++}>{other}</button></container>;
    }`);
    const recording = recordingHost();
    const counter = createDesktopApplication(recording.host).mount(Counter);
    await counter.ready;
    await counter.dispatch(0);
    expect(recording.transactions[1]!.operations[0]).toMatchObject({ values: [{ slot: 0, value: '1' }] });
    await counter.dispatch(1);
    expect(recording.transactions[2]!.operations[0]).toMatchObject({ values: [{ slot: 1, value: '1' }] });
    await counter.dispose();
  });

  it.each([
    [`export function Counter(){ return <Counter />; }`, 'component tags require desktop component linking'],
    [`export function Counter(){ let x=0; return <button onClick={async()=>x++}>{x}</button>; }`, 'asynchronous callbacks'],
    [`export function Counter(){ let x=0; const y=x+1; return <button onClick={()=>x++}>{y}</button>; }`, 'reactive setup derivations'],
    [`export function Counter(){ let x=0; function label(){return x+1;} const y=label(); return <button onClick={()=>x++}>{y}</button>; }`, 'reactive setup derivations'],
    [`export function Counter(){ let x=true; return <button onClick={()=>x=!x}>{x && <text>yes</text>}</button>; }`, 'structural expressions'],
    [`export function Counter(){ let color='red'; return <button style={{color}}>Hi</button>; }`, 'style objects currently require static values'],
  ])('rejects unsupported contracts with an authored diagnostic', (source, message) => {
    expect(() => compileDesktop(source, { moduleId: 'unsupported.tsx' })).toThrow(message);
  });
});
