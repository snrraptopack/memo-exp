import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileModules } from '@memoized-dom/compiler';
import {
  commit,
  mount,
  registerRootFactory,
  resetScheduler,
} from '@memoized-dom/runtime';
import {
  createDataRuntime,
  setActiveDataRuntime,
} from '@memoized-dom/data';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'fixtures', 'out', 'transparent-source-mutations');
mkdirSync(outDir, { recursive: true });

describe('Transparent source mutations, delegated events, and routed access resolution', () => {
  it('emits commitWrites on transparent array mutations and reconciles list immediately', async () => {
    resetScheduler();

    const modules = {
      './session.ts': `
        import { $fetch } from '@memoized-dom/data';
        export interface Story { id: number; title: string; votes: number; }
        export const stories = $fetch<Story[]>('/api/stories');
      `,
      './App.tsx': `
        import { Group, Pending, Error as ErrorArm } from '@memoized-dom/data';
        import { stories, type Story } from './session';

        function PendingView() { return <p class="loading">Loading...</p>; }
        function ErrorView({ error, retry: _retry }: { error: { message: string }; retry: () => void }) {
          return <p class="error">{error.message}</p>;
        }

        function StoryRow({ item }: { item: Story }) {
          function handleUpvote() {
            item.votes++;
          }
          return (
            <li class="story-item">
              <button class="vote-btn" onClick={handleUpvote}>▲</button>
              <span class="votes">{item.votes}</span>
            </li>
          );
        }

        export function App() {
          function handlePublish() {
            stories.unshift({
              id: 99,
              title: 'Published Story',
              votes: 1,
            });
          }

          return (
            <div class="app-root">
              <button class="publish-btn" onClick={handlePublish}>+ Publish</button>
              <Group>
                <Pending component={PendingView} />
                <ErrorArm component={ErrorView} />
                <ul class="list">
                  {stories.map((item) => <StoryRow item={item} key={item.id} />)}
                </ul>
              </Group>
            </div>
          );
        }
      `,
    };

    const compiled = compileModules(modules, { runtimePath: '@memoized-dom/runtime' });
    const appPath = join(outDir, 'app-publish.js');
    const sessionPath = join(outDir, 'session.js');

    writeFileSync(sessionPath, compiled['./session.ts']!);
    writeFileSync(appPath, compiled['./App.tsx']!);

    // An opaque receiver call must also account for retained row content.
    expect(compiled['./App.tsx']).toContain('commitWrites');
    expect(compiled['./App.tsx']).toContain('"./session.ts#stories"');

    const mockStories = [
      { id: 1, title: 'Story 1', votes: 10 },
      { id: 2, title: 'Story 2', votes: 20 },
    ];

    const dataRuntime = createDataRuntime({
      fetch: (async () =>
        new Response(JSON.stringify(mockStories), {
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch,
    });
    setActiveDataRuntime(dataRuntime);

    // Test cases that exercise dynamic module loading boundaries
    const appMod = await import(pathToFileURL(appPath).href + `?t=${Date.now()}`);

    registerRootFactory(appMod.App, {
      id: 'App',
      create: () => appMod.App('App', null),
    });

    const host = document.createElement('div');
    host.id = 'root';
    document.body.appendChild(host);

    const app = mount('root', appMod.App);
    await dataRuntime.settle(1000);
    commit();

    const itemsBefore = host.querySelectorAll('.story-item');
    expect(itemsBefore).toHaveLength(2);
    expect(host.innerHTML).toContain('10');
    expect(host.innerHTML).toContain('20');

    // 1. Click publish button -> must prepend story immediately
    const publishBtn = host.querySelector('.publish-btn') as HTMLButtonElement;
    publishBtn.click();
    commit();

    const itemsAfterPublish = host.querySelectorAll('.story-item');
    expect(itemsAfterPublish).toHaveLength(3);
    const firstRowVotes = host.querySelector('.story-item .votes')?.textContent;
    expect(firstRowVotes).toBe('1');

    // 2. Click upvote button on first row -> delegated event must fire and update row text immediately
    const voteBtn = host.querySelector('.story-item .vote-btn') as HTMLButtonElement;
    voteBtn.click();
    commit();

    const updatedVotes = host.querySelector('.story-item .votes')?.textContent;
    expect(updatedVotes).toBe('2');

    app.unmount();
    host.remove();
  });

  it('generates wildcard route access patterns for components mounted under routes', () => {
    const modules = {
      './session.ts': `
        import { $fetch } from '@memoized-dom/data';
        export interface Story { id: number; title: string; }
        export const stories = $fetch<Story[]>('/api/stories');
      `,
      './App.tsx': `
        import { Group, Pending, Error as ErrorArm } from '@memoized-dom/data';
        import { route } from '@memoized-dom/router';
        import { stories, type Story } from './session';

        function PendingView() { return <p class="loading">Loading...</p>; }
        function ErrorView({ error, retry: _retry }: { error: { message: string }; retry: () => void }) {
          return <p class="error">{error.message}</p>;
        }

        function StoryRow({ item }: { item: Story }) {
          return <li class="story-item">{item.title}</li>;
        }

        function Stories() {
          return (
            <div>
              <Group>
                <Pending component={PendingView} />
                <ErrorArm component={ErrorView} />
                <ul class="list">
                  {stories.map((item) => <StoryRow item={item} key={item.id} />)}
                </ul>
              </Group>
            </div>
          );
        }

        export function App() {
          return (
            <div class="shell" route="/">
              <Stories route="/stories" />
            </div>
          );
        }
      `,
    };

    const compiled = compileModules(modules, { runtimePath: '@memoized-dom/runtime' });

    // Verify access table contains wildcard route path for nested components
    expect(compiled['./App.tsx']).toMatch(/App\/\*\*\/Stories\/when0/);
  });
});
