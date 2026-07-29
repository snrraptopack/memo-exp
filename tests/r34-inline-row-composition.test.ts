/**
 * R34 - nested components and lists inside keyed inline host rows.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
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
const SOURCE = `
  let suffix = "!";

  function Badge({ label }) {
    return <strong class="badge">{label}{suffix}</strong>;
  }

  export function App() {
    let groups = [{
      id: "g1",
      label: "Group",
      children: [
        { id: "c1", label: "one" },
        { id: "c2", label: "two" },
      ],
    }];

    return <main>
      <button id="replace" onClick={() => {
        groups = [{
          id: "g1",
          label: "Group updated",
          children: [
            { id: "c2", label: "two updated" },
            { id: "c1", label: "one updated" },
          ],
        }];
      }}>replace</button>
      <button id="suffix" onClick={() => suffix += "!"}>suffix</button>
      <button id="remove" onClick={() => groups = []}>remove</button>

      <section id="groups">{groups.map(group =>
        <article key={group.id} class="group">
          <Badge label={group.label} />
          <ul>{group.children.map(child =>
            <li key={child.id} class="child">{child.label}</li>
          )}</ul>
        </article>
      )}</section>
    </main>;
  }
`;

function importCompiled(): Promise<any> {
  const specifier = './fixtures/out/r34-inline-row-composition.compiled.ts';
  return import(specifier);
}

function childTexts(): string[] {
  return [...document.querySelectorAll('.child')].map(
    (node) => node.textContent ?? '',
  );
}

describe('R34 - inline row composition', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r34-inline-row-composition.compiled.ts'),
      compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((callback) => callback());
  });

  afterEach(() => {
    resetScheduler();
  });

  it('emits nested row ownership and component reader patterns', () => {
    const code = compile(SOURCE);
    expect(code).toContain('.createListRegion(');
    expect(code.match(/\.createListRegion\(/g)).toHaveLength(2);
    expect(code).toContain('App/groups/Row[*]/Badge');
    expect(code).not.toContain('nested lists inside list rows');
  });

  it('reuses nested identities while replacing retained row data', async () => {
    const { App } = await importCompiled();
    document.body.appendChild(App('App', null));

    const badge = document.querySelector('.badge')!;
    const childOne = document.querySelectorAll('.child')[0]!;
    expect(badge.textContent).toBe('Group!');
    expect(childTexts()).toEqual(['one', 'two']);

    document.querySelector<HTMLButtonElement>('#replace')!.click();
    expect(document.querySelector('.badge')).toBe(badge);
    expect(badge.textContent).toBe('Group updated!');
    expect(childTexts()).toEqual(['two updated', 'one updated']);
    expect(document.querySelectorAll('.child')[1]).toBe(childOne);

    document.querySelector<HTMLButtonElement>('#suffix')!.click();
    expect(badge.textContent).toBe('Group updated!!');

    document.querySelector<HTMLButtonElement>('#remove')!.click();
    expect(document.querySelector('.badge')).toBeNull();
    expect(
      [..._internals().registry.keys()].some((id) => id.endsWith('/Badge')),
    ).toBe(false);
  });
});
