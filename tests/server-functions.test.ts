import { describe, expect, it } from 'vitest';
import {
  analyzeServerFunctionModule,
  generateServerFunctionClient,
  generateServerFunctionDeclarations,
  serverFunctionModuleName,
} from '@memoized-dom/compiler';

describe('named HTTP server functions', () => {
  it('discovers endpoints, parameter transport, and middleware', () => {
    const module = analyzeServerFunctionModule(`
      import { database } from '../../database';
      export const middleware = [requireAuth()];
      export async function getStory(id: number, preview = false) {
        return database.story(id, preview);
      }
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
      export async function getStories() { return []; }
      export async function getStory(id: number) { return { id }; }
      export async function deleteStory(id: number) { return { id }; }
    `, { moduleId: '/app/server/functions/stories.ts' });

    const client = generateServerFunctionClient(module);

    expect(client).toContain("import { $fetch as __mmd_fetch } from \"@memoized-dom/data\"");
    expect(client).toContain('return __mmd_fetch("/_fn/stories/getStories")');
    expect(client).toContain('query: { id }');
    expect(client).toContain('method: "DELETE", body: { id }');
    expect(client).not.toContain('return [];');
  });

  it('generates a declaration barrel that keeps ResolvedValue semantics', () => {
    const first = analyzeServerFunctionModule(`
      export const middleware = [requireAuth()];
      export async function getStories() { return []; }
      export async function getStory(id: number, preview = false) { return { id }; }
      export async function postVote(id: number) { return { id }; }
    `, { moduleId: '/app/server/functions/stories.ts' });
    const second = analyzeServerFunctionModule(`
      export async function getMe() { return {}; }
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
      'import type * as __mmd_impl_0 from "../server/functions/stories.js"',
    );
    expect(declarations).toContain(
      'import type * as __mmd_impl_1 from "../server/functions/me.js"',
    );
    expect(declarations).toContain(
      'export declare function getStories(...args: Parameters<typeof __mmd_impl_0.getStories>): ResolvedValue<Awaited<ReturnType<typeof __mmd_impl_0.getStories>>>;',
    );
    expect(declarations).toContain(
      'export declare function getStory(...args: Parameters<typeof __mmd_impl_0.getStory>): ResolvedValue<Awaited<ReturnType<typeof __mmd_impl_0.getStory>>>;',
    );
    expect(declarations).toContain(
      'export declare function postVote(...args: Parameters<typeof __mmd_impl_0.postVote>): ResolvedValue<Awaited<ReturnType<typeof __mmd_impl_0.postVote>>>;',
    );
    expect(declarations).toContain(
      'export declare function getMe(...args: Parameters<typeof __mmd_impl_1.getMe>): ResolvedValue<Awaited<ReturnType<typeof __mmd_impl_1.getMe>>>;',
    );
    expect(declarations).not.toContain('middleware');
  });

  it('rejects duplicate exported names across the barrel', () => {
    const first = analyzeServerFunctionModule(
      'export async function getStory(id: number) { return { id }; }',
      { moduleId: '/app/server/functions/news/stories.ts' },
    );
    const second = analyzeServerFunctionModule(
      'export async function getStory(id: number) { return { id }; }',
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
      'export function getSession() {}',
      { moduleId: '/app/server/functions/auth.ts' },
    )).toThrow(/\[MMD-S003\].*must be async/);

    expect(() => analyzeServerFunctionModule(
      'export async function postStory({ title }: { title: string }) {}',
      { moduleId: '/app/server/functions/stories.ts' },
    )).toThrow(/\[MMD-S013\].*named identifiers/);

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
});
