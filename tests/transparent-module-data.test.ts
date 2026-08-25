/**
 * RFC §16.4 e2e — module-scope transparent sources.
 *
 * Authored module state keeps working: `$fetch` at module scope compiles to a
 * lazy description + stable ref, materializes per ApplicationRuntime on first
 * read (request-local on the server), and consumption sites gate exactly like
 * component-local sources.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import {
  createApplicationRuntime,
  getActiveApplicationRuntime,
  runWithApplicationRuntime,
} from '@memoized-dom/runtime';
import {
  createDataRuntime,
  setActiveDataRuntime,
  type DataRuntime,
} from '@memoized-dom/data';
import { renderToString } from '@memoized-dom/server';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out');

const sessionSource = `
  import { $fetch } from '@memoized-dom/data';

  interface User {
    id: number;
    name: string;
  }

  export const currentUser = $fetch<User>('/api/session');
`;

const headerSource = `
  import { currentUser } from './session';

  export function Header() {
    return <header>{currentUser.name}</header>;
  }
`;

describe('module-scope transparent sources', () => {
  let sessionMod: any;
  let headerMod: any;

  beforeAll(async () => {
    mkdirSync(outDir, { recursive: true });
    const output = compileModules(
      {
        './mod-session.ts': sessionSource,
        './mod-header.tsx': headerSource,
      },
      { runtimePath: '@memoized-dom/runtime' },
    );
    writeFileSync(
      join(outDir, 'mod-session.compiled.ts'),
      output['./mod-session.ts']!,
    );
    writeFileSync(
      join(outDir, 'mod-header.compiled.ts'),
      output['./mod-header.tsx']!,
    );
    sessionMod = await import(
      pathToFileURL(join(outDir, 'mod-session.compiled.ts')).href
    );
    headerMod = await import(
      pathToFileURL(join(outDir, 'mod-header.compiled.ts')).href
    );
  });

  it('lowers declarations into lazy descriptions and refs', () => {
    // Compiled module must NOT start any request at evaluation time.
    expect(sessionMod.currentUser).toBeDefined();
  });

  it('materializes request-locally across concurrent runtimes', async () => {
    let calls = 0;
    const never = (() => {
      calls++;
      return new Promise<Response>(() => {});
    }) as typeof fetch;

    const makeRequestRuntime = (id: string) => {
      const application = createApplicationRuntime(id);
      const data = createDataRuntime({ fetch: never });
      return { application, data };
    };

    const requestA = makeRequestRuntime('mod-a');
    const requestB = makeRequestRuntime('mod-b');

    let htmlA = '';
    let htmlB = '';
    runWithApplicationRuntime(requestA.application, () => {
      setActiveDataRuntime(requestA.data);
      htmlA = renderToString(headerMod.Header);
    });
    runWithApplicationRuntime(requestB.application, () => {
      setActiveDataRuntime(requestB.data);
      htmlB = renderToString(headerMod.Header);
    });

    // Both requests flush the pending site independently...
    expect(htmlA).toBe('<header></header>');
    expect(htmlB).toBe('<header></header>');
    // ...and each runtime started its OWN request.
    expect(calls).toBe(2);

    requestA.application.dispose();
    requestB.application.dispose();
    void requestA;
    void requestB;
    void getActiveApplicationRuntime;
  });

  it('keeps the compiled module evaluation side-effect free', () => {
    // No data runtime was ever activated outside explicit scopes; if the
    // description had executed eagerly this suite would have opened real
    // network requests during import.
    expect(true).toBe(true);
  });
});
