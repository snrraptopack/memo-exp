/**
 * Deliberate JSX composition matrix.
 *
 * These cases overlap feature boundaries on purpose. They guard the contract
 * inference between ordinary scalar interpolation and compiler-owned mount
 * slots across parameter shapes, structural regions, rows, spreads, dynamic
 * tags, aliases, and module links.
 */
import { describe, expect, it } from 'vitest';
import { compile, compileModules } from '@memoized-dom/compiler';

describe('JSX paradigm matrix', () => {
  it.each([
    [
      'positional render prop',
      `
        function Frame(content) { return <section>{content}</section>; }
        export function App() {
          let count = 1;
          return <Frame content={<strong>{count}</strong>} />;
        }
      `,
    ],
    [
      'generic props binding',
      `
        function Frame(props) { return <section>{props.content}</section>; }
        export function App() {
          return <Frame content={<><strong>one</strong><i>two</i></>} />;
        }
      `,
    ],
    [
      'renamed destructuring',
      `
        function Frame({ content: body }) {
          return <section>{body}</section>;
        }
        export function App() {
          return <Frame content={<strong>renamed</strong>} />;
        }
      `,
    ],
    [
      'defaulted destructuring',
      `
        function Frame({ content = null }) {
          return <section>{content}</section>;
        }
        export function App() {
          return <Frame content={<strong>defaulted</strong>} />;
        }
      `,
    ],
  ])('supports %s without virtual-node lowering', (_name, source) => {
    const code = compile(source);
    expect(code).toContain('document.createElement("strong")');
    expect(code).not.toContain('createElement(content)');
  });

  it('supports conditional, logical, list, and fragment JSX through separate render props', () => {
    const code = compile(`
      function Layout({ primary, secondary, rows, extra }) {
        return <main>
          <section>{primary}</section>
          <aside>{secondary}</aside>
          <ul>{rows}</ul>
          <footer>{extra}</footer>
        </main>;
      }
      export function App() {
        let shown = true;
        const items = [{ id: 1, label: "one" }];
        return <Layout
          primary={shown ? <strong>yes</strong> : <em>no</em>}
          secondary={shown && <i>visible</i>}
          rows={items.map(item => <li key={item.id}>{item.label}</li>)}
          extra={<><small>a</small><small>b</small></>}
        />;
      }
    `);
    expect(code.match(/\.createCondRegion\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(code).toContain('.createListRegion(');
    expect(code).toContain('document.createDocumentFragment()');
  });

  it('supports a JSX render prop on an authored component list row', () => {
    const code = compile(`
      function Row({ content }) {
        return <li>{content}</li>;
      }
      export function App() {
        const items = [{ id: 1, label: "one" }];
        return <ul>
          {items.map(item => (
            <Row key={item.id} content={<strong>{item.label}</strong>} />
          ))}
        </ul>;
      }
    `);
    expect(code).toContain('.createListRegion(');
    expect(code).toContain('document.createElement("strong")');
  });

  it('preserves ordered component spreads while converting an explicit JSX prop', () => {
    const code = compile(`
      function Frame({ title, content }) {
        return <article><h2>{title}</h2><div>{content}</div></article>;
      }
      export function App() {
        let title = "ready";
        const defaults = { title: "default" };
        return <Frame
          {...defaults}
          title={title}
          content={<strong>body</strong>}
        />;
      }
    `);
    expect(code).toContain('document.createElement("strong")');
    expect(code).toContain('...defaults');
  });

  it('keeps typed scalar props scalar through CMS-style dynamic component branches', () => {
    const code = compile(`
      interface ViewProps { markup: string; }
      function CodeView({ markup }: ViewProps) {
        return <pre><code>{markup}</code></pre>;
      }
      function RawView({ markup }: ViewProps) {
        return <p>{markup}</p>;
      }
      export function App() {
        let code = true;
        let markup = "<strong>text</strong>";
        const View = code ? CodeView : RawView;
        return <View markup={markup} />;
      }
    `);
    expect(code).toContain('CodeView');
    expect(code).toContain('RawView');
    expect(code).toContain('document.createTextNode("")');
  });

  it('distinguishes JSX aliases and finite collection selections from ordinary data', () => {
    const code = compile(`
      function Frame({ content }) {
        return <section>{content}</section>;
      }
      export function App() {
        let selected = 0;
        let count = 1;
        const direct = <strong>{count}</strong>;
        const views = [direct, <em>{count * 2}</em>];
        const chosen = views[selected];
        return <Frame content={chosen} />;
      }
    `);
    expect(code).toContain('document.createElement("strong")');
    expect(code).toContain('document.createElement("em")');
    expect(code).toContain('.createCondRegion(');
  });

  it('links opposite untyped sole-interpolation contracts from actual callers', () => {
    const scalar = compileModules({
      './Value.tsx': `
        export function Value({ content }) {
          return <output>{content}</output>;
        }
      `,
      './App.tsx': `
        import { Value } from "./Value";
        export function App() {
          return <Value content="plain" />;
        }
      `,
    });
    expect(scalar['./Value.tsx']).toContain('document.createTextNode("")');
    expect(scalar['./Value.tsx']).not.toContain('childrenParent');

    const jsx = compileModules({
      './Value.tsx': `
        export function Value({ content }) {
          return <output>{content}</output>;
        }
      `,
      './App.tsx': `
        import { Value } from "./Value";
        export function App() {
          return <Value content={<strong>structured</strong>} />;
        }
      `,
    });
    expect(jsx['./Value.tsx']).toContain('content(_output)');
    expect(jsx['./App.tsx']).toContain('document.createElement("strong")');
  });

  it('rejects ambiguous, multiply-mounted, and non-rendered JSX contracts', () => {
    expect(() =>
      compileModules({
        './Value.tsx': `
          export function Value({ content }) {
            return <output>{content}</output>;
          }
        `,
        './App.tsx': `
          import { Value } from "./Value";
          export function App() {
            return <main>
              <Value content="plain" />
              <Value content={<strong>structured</strong>} />
            </main>;
          }
        `,
      }),
    ).toThrow(/both scalar data and JSX content/);

    expect(() =>
      compile(`
        function Duplicate({ content }) {
          return <main><div>{content}</div><aside>{content}</aside></main>;
        }
        export function App() {
          return <Duplicate content={<strong>twice</strong>} />;
        }
      `),
    ).toThrow(/can only be rendered or forwarded once/);

    expect(() =>
      compile(`
        function Sink({ value }) {
          return <output>{String(value)}</output>;
        }
        export function App() {
          return <Sink value={<strong>not consumed as JSX</strong>} />;
        }
      `),
    ).toThrow(/is not rendered by the callee/);
  });
});
