/**
 * Golden emission snapshots — one fixture per emission-spec rule
 * (`emission-spec.md` is normative; these snapshots pin what the compiler
 * actually emits for the canonical minimal shape of each rule).
 *
 * First run writes `__snapshots__/emission-golden.test.ts.snap` — that file
 * is the committed golden. Any compiler change that alters emitted output
 * for a rule fails here and must be a deliberate, reviewed snapshot update.
 * This suite is also the parity oracle that future ESTree frontends diff
 * against (spec: both frontends implement the same document).
 */
import { describe, expect, it } from 'vitest';
import { compile, compileModules } from '@memoized-dom/compiler';

interface GoldenCase {
  rule: string;
  source: string;
  modules?: Record<string, string>;
}

const cases: GoldenCase[] = [
  {
    rule: 'R1 — components become (id, parent) factories registering an entity',
    source: `
      export function Counter() {
        let count = 0;
        return <button onClick={() => count++}>{count}</button>;
      }
    `,
  },
  {
    rule: 'R2 — JSX becomes a creation branch with cached nodes',
    source: `
      export function Card() {
        const ready = true;
        return (
          <section class="card" data-ready={ready}>
            <h1>Title</h1>
          </section>
        );
      }
    `,
  },
  {
    rule: 'R4 — update branch writes only dynamic slots, value-cached',
    source: `
      export function Label() {
        let name = 'a';
        return <span class={{ big: name.length > 2 }}>{name}</span>;
      }
    `,
  },
  {
    rule: 'R5 — component props become a props box with positional binding',
    source: `
      export function Row({ item, index }) {
        return <li>{item} at {index}</li>;
      }
    `,
  },
  {
    rule: 'R6 — children slots forward rendered content',
    source: `
      export function Shell({ header, children }) {
        return <div><header>{header}</header>{children}</div>;
      }
    `,
  },
  {
    rule: 'R7 — keyed lists cache rows per key with stable identity',
    source: `
      export function Feed(items) {
        return (
          <ul>
            {items.map((item) => (
              <li key={item.id}>{item.label}</li>
            ))}
          </ul>
        );
      }
    `,
  },
  {
    rule: 'R8 — conditional regions anchor branch swaps',
    source: `
      export function Badge(loaded) {
        return (
          <>
            <if condition={loaded}>ready</if>
            <else>waiting</else>
          </>
        );
      }
    `,
  },
  {
    rule: 'R12/R13 — computeds compile to replaying derivation entities',
    source: `
      export function Totals(items) {
        const total = items.length * 2;
        return <output>{total}</output>;
      }
    `,
  },
  {
    rule: 'Module state — module-level let shares across instances',
    source: `
      export let selected = null;
      export function Picker() {
        return <button onClick={() => (selected = 'a')}>{selected}</button>;
      }
    `,
  },
  {
    rule: 'Effects — compiler-owned lifecycle registers deferred entities',
    source: `
      export function Ticker() {
        let ticks = 0;
        effect(() => {
          ticks++;
        });
        return <span>{ticks}</span>;
      }
    `,
  },
  {
    rule: 'Cleanup — ownership-scoped teardown',
    source: `
      export function Timer() {
        cleanup(() => {
          disposeTimer();
        });
        return <span>tick</span>;
      }
    `,
  },
  {
    rule: 'Transparent data — $fetch lowers to availability-gated reads',
    source: `
      import { $fetch } from '@memoized-dom/data';
      export function Profile() {
        const user = $fetch('/api/user');
        return <h1>{user.name}</h1>;
      }
    `,
  },
  {
    rule: 'Cross-module — imported state keeps canonical identity',
    modules: {
      './state.ts': `
        export let count = 0;
        export function bump() {
          count++;
        }
      `,
      './app.tsx': `
        import { count, bump } from './state';
        export function App() {
          return <button onClick={bump}>{count}</button>;
        }
      `,
    },
  },
  {
    rule: 'R20 — factory callbacks and explicit cleanup are entity-owned',
    source: `
      export function LiveFeed() {
        let status = 'idle';
        const sub = subscribe((val) => {
          status = val;
        });
        cleanup(() => sub.unsubscribe());
        return <span>{status}</span>;
      }
    `,
  },
  {
    rule: 'R24 — component props with default values and destructuring',
    source: `
      export function Avatar({ user = { name: 'anon' }, size = 32 }) {
        return <img alt={user.name} width={size} />;
      }
    `,
  },
  {
    rule: 'R31 — explicit innerHTML is a guarded raw-HTML property',
    source: `
      export function RawViewer(htmlContent) {
        return <div innerHTML={htmlContent} />;
      }
    `,
  },
  {
    rule: 'R32 — module effects are linked singleton entities',
    source: `
      let route = '/';
      effect(() => {
        document.title = route;
      });
      export function Nav() {
        return <button onClick={() => { route = '/about'; }}>go</button>;
      }
    `,
  },
  {
    rule: 'R40 — arrow and function-expression components normalize to factories',
    source: `
      export const ArrowBadge = ({ label }) => <span>{label}</span>;
      export const ExprCard = function({ title }) {
        return <div>{title}</div>;
      };
    `,
  },
  {
    rule: 'R42 — calculated list sources use the normal derivation contract',
    source: `
      let filter = 'all';
      let items = [{ id: 1, text: 'a', done: false }];
      export function FilteredList() {
        return (
          <ul>
            {items.filter(i => filter === 'all' || i.done).map(item => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
        );
      }
    `,
  },
  {
    rule: 'R44 — DOM refs are compiler-native lifecycle slots',
    source: `
      export function CanvasView() {
        let canvasEl = null;
        return <canvas ref={canvasEl} />;
      }
    `,
  },
];

describe('emission golden snapshots (emission-spec.md)', () => {
  for (const { rule, source, modules } of cases) {
    it(rule, () => {
      if (modules !== undefined) {
        const output = compileModules(modules, {
          resolveImport: (specifier, importer) => {
            const dir = importer.slice(0, importer.lastIndexOf('/'));
            const joined = `${dir}/${specifier.slice(2)}`;
            return modules[joined] !== undefined ? joined : undefined;
          },
        });
        // Multi-module: snapshot each module's emission keyed by module id.
        for (const [id, code] of Object.entries(output)) {
          expect(code).toMatchSnapshot(id);
        }
      } else {
        expect(compile(source)).toMatchSnapshot();
      }
    });
  }
});
