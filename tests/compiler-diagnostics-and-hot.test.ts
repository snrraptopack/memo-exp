import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  compilerDiagnosticCode,
  diagnose,
  diagnoseModules,
} from '@memoized-dom/compiler';
import {
  applyHotUpdate,
  register,
  registerHotComponent,
  registeredIds,
  unregister,
  type HotComponentFactory,
} from '@memoized-dom/runtime/testing';

afterEach(() => {
  document.body.replaceChildren();
  for (const id of [...registeredIds()]) unregister(id);
});

describe('compiler-owned diagnostics', () => {
  const invalid = `
    export function App() {
      let count = 0;
      const double = count * 2;
      return <button onClick={() => double++}>{double}</button>;
    }
  `;

  it('reports direct and graph compilation through one stable shape', () => {
    const direct = diagnose(invalid, { moduleId: './App.tsx' });
    const graph = diagnoseModules({ './App.tsx': invalid });

    expect(direct).toHaveLength(1);
    expect(graph).toHaveLength(1);
    expect(graph[0]).toMatchObject({
      code: compilerDiagnosticCode,
      source: 'memoized-dom',
      severity: 'error',
      moduleId: './App.tsx',
    });
    expect(graph[0]!.message).toBe(direct[0]!.message);
    expect(graph[0]!.message).toContain(
      "cannot update per-instance derivation 'double'",
    );
  });
});

describe('live component replacement', () => {
  function factory(text: string): HotComponentFactory {
    const component: HotComponentFactory = (id, parent, props) => {
      const element = document.createElement('button');
      element.textContent = `${text}:${String(props?.[0] ?? '')}`;
      register({ id, parent, render() {} });
      registerHotComponent(component, id, parent, [element], props ?? null);
      return element;
    };
    return component;
  }

  it('replaces only live instances and preserves their current props box', () => {
    const previous = factory('before');
    const next = factory('after');
    const props = ['one'];
    document.body.append(previous('App/Child', 'App', props));
    props[0] = 'two';

    applyHotUpdate([[previous, next, false]], 'App');

    expect(document.body.textContent).toBe('after:two');
    expect(registeredIds()).toContain('App/Child');
  });
});
