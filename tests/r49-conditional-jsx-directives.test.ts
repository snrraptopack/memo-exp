import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { compile } from '@memoized-dom/compiler';
import {
  _internals,
  resetAccessTable,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');
const outputFile = join(outDir, 'r49-conditional-directives.compiled.ts');

const SOURCE = `
  function Phase({ id, label }) {
    return <p id={id}>{label}</p>;
  }

  export function App() {
    let phase = 0;
    return <main>
      <button id="next" onClick={() => phase = (phase + 1) % 4}>next</button>
      <Phase id="zero" label="zero" if={phase === 0} />
      {/* formatting comments do not interrupt the chain */}
      <Phase id="one" label="one" else-if={phase === 1} />
      <Phase id="two" label="two" else-if={phase === 2} />
      <Phase id="other" label="other" else />
    </main>;
  }
`;

describe('compiler-owned JSX conditional directives', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outputFile, compile(SOURCE));
  });

  afterEach(() => {
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    resetScheduler();
    document.body.replaceChildren();
  });

  it('lowers a multi-branch sibling chain to one conditional region', () => {
    const code = compile(SOURCE);

    expect(code.match(/\.createCondRegion\(/g)).toHaveLength(1);
    expect(code).not.toContain('setAttribute("if"');
    expect(code).not.toContain('setAttribute("else-if"');
    expect(code).not.toContain('setAttribute("else"');
  });

  it('reactively selects component if, repeated else-if, and else branches', async () => {
    setScheduler((work) => work());
    const { App } = await import(
      /* @vite-ignore */ pathToFileURL(outputFile).href
    );
    document.body.appendChild(App('ConditionalDirectives', null));

    const visible = () => document.querySelector('p')?.id;
    const next = document.querySelector<HTMLButtonElement>('#next')!;
    expect(visible()).toBe('zero');
    next.click();
    expect(visible()).toBe('one');
    next.click();
    expect(visible()).toBe('two');
    next.click();
    expect(visible()).toBe('other');
    next.click();
    expect(visible()).toBe('zero');
  });

  it('allows a standalone if directive, including at a component root', () => {
    const code = compile(`
      let visible = true;
      function App() {
        return <section if={visible}>Visible</section>;
      }
    `);

    expect(code).toContain('.createCondRegion(');
    expect(code).not.toContain('setAttribute("if"');
  });

  it('rejects orphaned, interrupted, malformed, and duplicate directives', () => {
    expect(() => compile(`function App() { return <main><p else /></main>; }`))
      .toThrow('else must immediately follow');
    expect(() => compile(`function App() { return <main><p else-if={true} /></main>; }`))
      .toThrow('else-if must immediately follow');
    expect(() => compile(`function App() { return <main><p if={true} /><hr /><p else /></main>; }`))
      .toThrow('else must immediately follow');
    expect(() => compile(`function App() { return <main><p if /></main>; }`))
      .toThrow('if directive requires an expression');
    expect(() => compile(`function App() { return <main><p if={true} else /></main>; }`))
      .toThrow('only one of if, else-if, or else');
    expect(() => compile(`function App() { return <main><p if={true} /><p else={true} /></main>; }`))
      .toThrow('else directive does not accept a value');
  });
});
