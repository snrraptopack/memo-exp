import { describe, expect, it } from 'vitest';
import { compile, compileModules } from '@memoized-dom/compiler';

function compileExternal(source: string): string {
  return compileModules({ './app.tsx': source })['./app.tsx']!;
}

describe('opaque external mutation fallback', () => {
  it('marks a component volatile when rendered state escapes to an imported API', () => {
    const code = compileExternal(`
      import { animate } from 'animejs';

      export function App() {
        const hidden = { value: 0 };
        function start() {
          animate(hidden, { value: 100, duration: 800 });
        }
        return <main>
          <button onClick={start}>start</button>
          <output>{hidden.value}</output>
        </main>;
      }
    `);

    expect(code).toMatch(/\.register\(\{[\s\S]*?volatile: true[\s\S]*?\}\)/);
  });

  it('marks an opaque call result volatile when its pull value is rendered', () => {
    const code = compileExternal(`
      import { createClock } from 'external-clock';

      export function App() {
        const clock = createClock();
        return <output>{clock.value}</output>;
      }
    `);

    expect(code).toContain('volatile: true');
  });

  it('tracks opaque results nested in object initializers and member assignments', () => {
    const initialized = compileExternal(`
      import { createClock } from 'external-clock';
      export function App() {
        const state = { clock: createClock() };
        return <output>{state.clock.value}</output>;
      }
    `);
    const assigned = compileExternal(`
      import { createClock } from 'external-clock';
      export function App() {
        const state = { clock: null };
        state.clock = createClock();
        return <output>{state.clock.value}</output>;
      }
    `);

    expect(initialized).toContain('volatile: true');
    expect(assigned).toContain('volatile: true');
  });

  it('tracks live instances constructed by an imported class', () => {
    const code = compileExternal(`
      import { Clock } from 'external-clock';
      export function App() {
        const clock = new Clock();
        return <output>{clock.value}</output>;
      }
    `);

    expect(code).toContain('volatile: true');
  });

  it('tracks pull-readable singleton state imported from an opaque package', () => {
    const code = compileExternal(`
      import { clock } from 'external-clock';
      export function App() {
        return <output>{clock.value}</output>;
      }
    `);

    expect(code).toContain('volatile: true');
  });

  it('tracks module state passed to opaque code by a component', () => {
    const code = compileExternal(`
      import { animate } from 'external-animation';
      const state = { value: 0 };
      export function App() {
        animate(state, { value: 100 });
        return <output>{state.value}</output>;
      }
    `);

    expect(code).toContain('volatile: true');
  });

  it('tracks linked state passed to an opaque external package', () => {
    const output = compileModules({
      './state.ts': `export const state = { value: 0 };`,
      './app.tsx': `
        import { state } from './state';
        import { animate } from 'external-animation';
        export function App() {
          animate(state, { value: 100 });
          return <output>{state.value}</output>;
        }
      `,
    });

    expect(output['./app.tsx']).toContain('volatile: true');
  });

  it('tracks opaque factory results created at module scope', () => {
    const code = compileExternal(`
      import { createClock } from 'external-clock';
      const clock = createClock();
      export function App() {
        return <output>{clock.value}</output>;
      }
    `);

    expect(code).toContain('volatile: true');
  });

  it('does not start polling when escaped state is not part of render output', () => {
    const code = compileExternal(`
      import { animate } from 'animejs';

      export function App() {
        const hidden = { value: 0 };
        animate(hidden, { value: 100 });
        return <main>ready</main>;
      }
    `);

    expect(code).not.toContain('volatile: true');
  });

  it('keeps compiler-visible local helpers on the static fast path', () => {
    const code = compile(`
      function setValue(target) {
        target.value = 100;
      }

      export function App() {
        const state = { value: 0 };
        setValue(state);
        return <output>{state.value}</output>;
      }
    `);

    expect(code).not.toContain('volatile: true');
  });

  it('keeps graph-linked imported helpers on the static fast path', () => {
    const output = compileModules({
      './helper.ts': `
        export function setValue(target) {
          target.value = 100;
        }
      `,
      './app.tsx': `
        import { setValue } from './helper';
        export function App() {
          const state = { value: 0 };
          setValue(state);
          return <output>{state.value}</output>;
        }
      `,
    });

    expect(output['./app.tsx']).not.toContain('volatile: true');
  });

  it('does not route pull-only frame refreshes back into local effects', () => {
    const code = compileExternal(`
      import { animate } from 'animejs';

      export function App() {
        const state = { value: 0 };
        let started = false;
        effect(() => {
          if (started) animate(state, { value: 100 });
        });
        return <button onClick={() => started = true}>{state.value}</button>;
      }
    `);

    expect(code).toContain('volatile: true');
    expect(code).toMatch(/!== -1|=== -1/);
  });
});
