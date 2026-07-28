/**
 * R7 - list regions owned by listed row components.
 */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { compile } from '@memoized-dom/compiler';
import { resetAccessTable } from '@memoized-dom/runtime/testing';
import {
  _internals,
  resetScheduler,
  setScheduler,
  unregister,
} from '@memoized-dom/runtime/testing';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

const SOURCE = `
  function Leaf({ child, index }) {
    return <li class="leaf" data-id={child.id}>
      {index}:{child.label}
    </li>;
  }

  function Group({ group }) {
    return <section class="group">
      <h2>{group.label}</h2>
      <ul>{group.children.map((child, index) =>
        <Leaf key={child.id} child={child} index={index} />
      )}</ul>
    </section>;
  }

  export function App() {
    let groups = [{
      id: 'g1',
      label: 'Group',
      children: [
        { id: 'c1', label: 'one' },
        { id: 'c2', label: 'two' },
      ],
    }];
    return <main>
      <button id="replace" onClick={() => {
        groups = [{
          id: 'g1',
          label: 'Group!',
          children: [
            { id: 'c2', label: 'two!' },
            { id: 'c1', label: 'one!' },
          ],
        }];
      }}>replace</button>
      <div>{groups.map(group =>
        <Group key={group.id} group={group} />
      )}</div>
    </main>;
  }
`;

function importCompiled(): Promise<any> {
  const specifier = './fixtures/out/r7-nested-list.compiled.ts';
  return import(specifier);
}

function leafTexts(): string[] {
  return [...document.querySelectorAll('.leaf')].map(
    (node) => node.textContent?.trim() ?? '',
  );
}

describe('R7 - nested lists in row components', () => {
  beforeAll(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'r7-nested-list.compiled.ts'),
      compile(SOURCE, { runtimePath: '@memoized-dom/runtime' }),
    );
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
    setScheduler((fn) => fn());
  });

  afterEach(() => {
    resetScheduler();
  });

  it('combines listed-owner paths for nested row placement', () => {
    const code = compile(SOURCE);
    expect(code).toMatch(
      /_id\d* \+ "\/children"/,
    );
    expect(code).not.toContain(
      'lists inside list-row components are not supported',
    );
  });

  it('reconciles nested keyed rows after the outer item is replaced', async () => {
    const { App } = await importCompiled();
    document.body.appendChild(App('App', null));

    expect(document.querySelector('.group h2')?.textContent).toBe('Group');
    expect(leafTexts()).toEqual(['0:one', '1:two']);
    const childOne = document.querySelector('[data-id="c1"]')!;

    document.querySelector<HTMLButtonElement>('#replace')!.click();

    expect(document.querySelector('.group h2')?.textContent).toBe(
      'Group!',
    );
    expect(leafTexts()).toEqual(['0:two!', '1:one!']);
    expect(document.querySelectorAll('.leaf')[1]).toBe(childOne);
  });
});
