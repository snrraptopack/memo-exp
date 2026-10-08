import { describe, expect, it } from 'bun:test';
import {
  analyzeServerFunctionModule,
  compileModules,
  generateServerFunctionClient,
  generateServerFunctionDeclarations,
  generateServerFunctionImplementation,
  serverFunctionModuleName,
} from '@memoized-dom/compiler';

describe('named HTTP server functions', () => {
  it('discovers JSDoc methods on declarations and aliased arrow functions', () => {
    const source = `
      import { requireUser, limits } from './middleware';
      const voteInput = schema();
      /**
       * Read stories.
       * @GET
       */
      export async function stories(limit: number = 20) { return []; }
      /**
       * @POST
       * @middleware[requireUser, limits.vote({ count: 10 })]
       * @Input voteInput
       */
      const save = async (id: number) => ({ id });
      export { save as vote };
    `;
    const options = { moduleId: '/app/server/functions/stories.ts' };
    const module = analyzeServerFunctionModule(source, options);
    expect(module.functions).toEqual([
      expect.objectContaining({ exported: 'stories', method: 'GET', parameters: [{ name: 'limit', optional: true, queryKind: 'number' }] }),
      expect.objectContaining({ exported: 'vote', local: 'save', method: 'POST', middleware: '[requireUser, limits.vote({ count: 10 })]', input: 'voteInput' }),
    ]);
    const implementation = generateServerFunctionImplementation(source, options);
    expect(implementation).toContain('["vote"]: { middleware: [requireUser, limits.vote({ count: 10 })], input: voteInput }');
    const client = generateServerFunctionClient(module);
    expect(client).toContain('export function vote(id)');
    expect(client).not.toContain('requireUser');
    expect(client).not.toContain('voteInput');
  });

  it('uses the annotation independently of the function name', () => {
    const module = analyzeServerFunctionModule('/** @POST */ export async function getAccessToken() {}', {
      moduleId: '/app/server/functions/auth.ts',
    });
    expect(module.functions[0]?.method).toBe('POST');
  });

  it.each(['get', 'post', 'put', 'patch', 'delete'])(
    'rejects unannotated %s-prefixed functions and export aliases', prefix => {
      const options = { moduleId: '/app/server/functions/stories.ts' };
      expect(() => analyzeServerFunctionModule(`export async function ${prefix}Story() {}`, options))
        .toThrow(/MMD-S011/);
      expect(() => analyzeServerFunctionModule(`const story = async () => 1; export { story as ${prefix}Story };`, options))
        .toThrow(/MMD-S011/);
    },
  );

  it('does not interpret tag-looking strings in middleware configuration as annotations', () => {
    const module = analyzeServerFunctionModule(`
      import { limit } from './middleware';
      /**
       * @GET
       * @middleware [limit({ label: '@Input is ordinary text' })]
       */
      export async function stories() {}
    `, { moduleId: '/app/server/functions/stories.ts' });
    expect(module.functions[0]?.middleware).toBe("[limit({ label: '@Input is ordinary text' })]");
    expect(module.functions[0]?.input).toBeUndefined();
  });

  it('reports duplicate, malformed, and unresolved annotations at their declaration', () => {
    const options = { moduleId: '/app/server/functions/stories.ts' };
    for (const [source, message] of [
      ['/** @GET @POST */ export async function stories() {}', /duplicate/],
      ['/** @GET @middleware [missing] */ export async function stories() {}', /missing.*runtime binding/],
      ['/** @GET @middleware user */ export async function stories() {}', /array of middleware/],
      ['/** @GET @Input missing */ export async function stories() {}', /missing.*runtime binding/],
      ['/** @GET */ export const first = async () => 1, second = async () => 2;', /own declaration/],
      ['import type { guard } from "./guard"; /** @GET @middleware [guard] */ export async function stories() {}', /guard.*runtime binding/],
    ] as const) {
      expect(() => analyzeServerFunctionModule(source, options)).toThrow(message);
    }
  });

  it('does not attach annotation-looking strings or detached comments to functions', () => {
    expect(() => analyzeServerFunctionModule(`
      const text = '/** @GET */';
      /** @GET */
      const unrelated = 1;
      export async function stories() {}
    `, { moduleId: '/app/server/functions/stories.ts' })).toThrow(/MMD-S011/);
  });
  it('discovers endpoints, parameter transport, and middleware', () => {
    const module = analyzeServerFunctionModule(`
      import { database } from '../../database';
      export const middleware = [requireAuth()];
      /** @GET */
      export async function getStory(id: number, preview = false) {
        return database.story(id, preview);
      }
      /** @POST */
      const vote = async (id: number) => database.vote(id);
      export { vote as postVote };
    `, {
      moduleId: 'C:\\app\\server\\functions\\news\\stories.ts',
    });

    expect(module).toEqual({
      moduleId: 'C:\\app\\server\\functions\\news\\stories.ts',
      moduleName: 'news/stories',
      middlewareExport: true,
      functions: [
        {
          exported: 'getStory',
          local: 'getStory',
          method: 'GET',
          path: '/_fn/news/stories/getStory',
          parameters: [
            { name: 'id', optional: false, queryKind: 'number' },
            { name: 'preview', optional: true, queryKind: 'boolean' },
          ],
        },
        {
          exported: 'postVote',
          local: 'vote',
          method: 'POST',
          path: '/_fn/news/stories/postVote',
          parameters: [{ name: 'id', optional: false }],
        },
      ],
    });
  });

  it('generates a small $fetch-only client facade', () => {
    const module = analyzeServerFunctionModule(`
      /** @GET */ export async function getStories() { return []; }
      /** @GET */ export async function getStory(id: number) { return { id }; }
      /** @DELETE */ export async function deleteStory(id: number) { return { id }; }
    `, { moduleId: '/app/server/functions/stories.ts' });

    const client = generateServerFunctionClient(module);

    expect(client).toContain("import { $fetch as __mmd_fetch } from \"@memoized-dom/data\"");
    expect(client).toContain('return __mmd_fetch("/_fn/stories/getStories")');
    expect(client).toContain('query: { id }');
    expect(client).toContain('method: "DELETE", body: { id }');
    expect(client).not.toContain('transferKey');
    expect(client).not.toContain('return [];');
  });

  it('generates a declaration barrel that keeps ResolvedValue semantics', () => {
    const first = analyzeServerFunctionModule(`
      export const middleware = [requireAuth()];
      /** @GET */ export async function getStories() { return []; }
      /** @GET */ export async function getStory(id: number, preview = false) { return { id }; }
      /** @POST */ export async function postVote(id: number) { return { id }; }
    `, { moduleId: '/app/server/functions/stories.ts' });
    const second = analyzeServerFunctionModule(`
      /** @GET */ export async function getMe() { return {}; }
    `, { moduleId: '/app/server/functions/me.ts' });

    const declarations = generateServerFunctionDeclarations(
      [first, second],
      {
        resolveImplementation: id =>
          `../${id.replace(/^\/app\//, '').replace(/\.[cm]?[jt]sx?$/, '')}.js`,
      },
    );

    expect(declarations).toContain(
      'import type { ResolvedValue } from "@memoized-dom/data"',
    );
    expect(declarations).toContain(
      'import type { JsonResponse, ErrorResponse } from \'@memoized-dom/server\'',
    );
    expect(declarations).toContain(
      'type __mmdClientValue<T> = T extends ErrorResponse ? never : T extends JsonResponse<infer U> ? U : T extends Response ? unknown : T;',
    );
    expect(declarations).toContain(
      'import type * as __mmd_impl_0 from "../server/functions/stories.js"',
    );
    expect(declarations).toContain(
      'import type * as __mmd_impl_1 from "../server/functions/me.js"',
    );
    expect(declarations).toContain(
      'export declare function getStories(...args: Parameters<typeof __mmd_impl_0.getStories>): ResolvedValue<__mmdClientValue<Awaited<ReturnType<typeof __mmd_impl_0.getStories>>>>;',
    );
    expect(declarations).toContain(
      'export declare function getStory(...args: Parameters<typeof __mmd_impl_0.getStory>): ResolvedValue<__mmdClientValue<Awaited<ReturnType<typeof __mmd_impl_0.getStory>>>>;',
    );
    expect(declarations).toContain(
      'export declare function postVote(...args: Parameters<typeof __mmd_impl_0.postVote>): ResolvedValue<__mmdClientValue<Awaited<ReturnType<typeof __mmd_impl_0.postVote>>>>;',
    );
    expect(declarations).toContain(
      'export declare function getMe(...args: Parameters<typeof __mmd_impl_1.getMe>): ResolvedValue<__mmdClientValue<Awaited<ReturnType<typeof __mmd_impl_1.getMe>>>>;',
    );
    expect(declarations).not.toContain('middleware');
  });

  it('rejects duplicate exported names across the barrel', () => {
    const first = analyzeServerFunctionModule(
      '/** @GET */ export async function getStory(id: number) { return { id }; }',
      { moduleId: '/app/server/functions/news/stories.ts' },
    );
    const second = analyzeServerFunctionModule(
      '/** @GET */ export async function getStory(id: number) { return { id }; }',
      { moduleId: '/app/server/functions/shop/stories.ts' },
    );

    expect(() => generateServerFunctionDeclarations([first, second], {
      resolveImplementation: () => './stories.js',
    })).toThrow(/\[MMD-S012\].*news\/stories.*shop\/stories/s);
  });

  it('rejects invalid names, sync functions, and destructured parameters precisely', () => {
    expect(() => analyzeServerFunctionModule(
      'export async function authenticate() {}',
      { moduleId: '/app/server/functions/auth.ts' },
    )).toThrow(/\[MMD-S011\].*authenticate/);

    expect(() => analyzeServerFunctionModule(
      '/** @GET */ export function getSession() {}',
      { moduleId: '/app/server/functions/auth.ts' },
    )).toThrow(/\[MMD-S003\].*must be async/);

    expect(() => analyzeServerFunctionModule(
      '/** @POST */ export async function postStory({ title }: { title: string }) {}',
      { moduleId: '/app/server/functions/stories.ts' },
    )).toThrow(/\[MMD-S013\].*named identifiers/);

    expect(() => analyzeServerFunctionModule(
      '/** @GET */ export async function getValue(value: string | number) { return value; }',
      { moduleId: '/app/server/functions/values.ts' },
    )).toThrow(/\[MMD-S003\].*parameter 'value'.*query type/s);

    expect(() => analyzeServerFunctionModule(
      `import { database } from '../../database';
       export const databaseForTests = database;`,
      { moduleId: '/app/server/functions/stories.ts' },
    )).toThrow(/\[MMD-S003\].*databaseForTests/);
  });

  it('normalizes only modules beneath the configured functions root', () => {
    expect(serverFunctionModuleName(
      '/app/backend/http/users.ts',
      'backend/http',
    )).toBe('users');
    expect(() => serverFunctionModuleName('/app/client/users.ts'))
      .toThrow(/outside 'server\/functions\/'/);
  });

  it('rejects non-GET server functions during render but allows handlers', () => {
    const metadata = analyzeServerFunctionModule(`
      /** @POST */ export async function postVote(id: number) { return { id, votes: 4 }; }
    `, { moduleId: '/app/server/functions/stories.ts' });
    const facade = generateServerFunctionClient(metadata);

    expect(() => compileModules({
      './functions.ts': facade,
      './App.tsx': `
        import { postVote } from './functions';
        export function App() {
          postVote(1);
          return <main>Stories</main>;
        }
      `,
    })).toThrow(/\[MMD-S010\].*postVote.*HTTP POST.*component rendering/s);

    const output = compileModules({
      './functions.ts': facade,
      './App.tsx': `
        import { postVote } from './functions';
        export function App() {
          return <button onClick={() => postVote(1)}>Vote</button>;
        }
      `,
    });
    expect(output['./functions.ts']).toContain('/_fn/stories/postVote');
  });

  it('replays facade calls through the factory and resolves event-created values', () => {
    const metadata = analyzeServerFunctionModule(`
      /** @GET */ export async function getStory(id: number) { return { id }; }
      /** @POST */ export async function postVote(id: number) { return { id }; }
    `, { moduleId: '/app/server/functions/stories.ts' });
    const facade = generateServerFunctionClient(metadata);
    const output = compileModules({
      './functions.ts': facade,
      './App.tsx': `
        import { $track } from '@memoized-dom/data';
        import { getStory, postVote } from './functions';

        export function App() {
          let selectedId = 1;
          let lastVote: ReturnType<typeof postVote> | null = null;
          $effect(() => {
            console.log(lastVote);
          });
          return <main>
            <button onClick={() => { selectedId = 2; }}>Details</button>
            <button onClick={() => { lastVote = postVote(selectedId); }}>Vote</button>
            <Story id={selectedId} />
            {lastVote !== null && (
              <p>{$track(lastVote).pending ? 'Voting' : lastVote.id}</p>
            )}
          </main>;
        }

        function Story({ id }: { id: number }) {
          const story = getStory(id);
          return <h1>{story.id}</h1>;
        }
      `,
    });
    const compiled = output['./App.tsx']!;

    expect(compiled).toContain(
      'rebindResolvedValueFromFactory(story, () => getStory(id))',
    );
    expect(compiled).not.toContain('rebindResolvedValue(story, id)');
    expect(compiled).toContain('createEventSourceSlot()');
    expect(compiled).toContain('runResolvedValuesEffect([lastVote]');
    expect(compiled).toContain('readResolvedValueForRender(lastVote).id');
    expect(compiled).not.toContain('connectResolvedValues([lastVote]');
    expect(compiled).not.toContain(
      'readResolvedValue(lastVote, "lastVote"',
    );
    expect(compiled).not.toContain('lastVote.id');
  });
});
