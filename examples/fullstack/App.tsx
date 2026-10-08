/**
 * Application — colorless server functions.
 *
 * `#server-functions` is the generated client facade over
 * `server/functions/stories.ts`. Calls are plain function invocations that
 * resolve as `ResolvedValue<T>`:
 *
 *   - `stories` is a module-scope source: it settles during SSR through the
 *     in-memory `/_fn/stories/getStories` dispatch and hydrates from the
 *     payload with zero refetch.
 *   - `getStory(selectedId)` is a component-local source whose request
 *     rebinds reactively when the selected id changes.
 *   - `postVote` is a mutation: it may only be called from event handlers,
 *     and its lifecycle is observed through `$track`.
 */
import { getStories, getStory, vote } from '#server-functions';
import { Group } from '@memoized-dom/data';
import {optimistic} from "@memoized-dom/utils"
import type { ErrorPolicyComponentProps } from '@memoized-dom/data';


export function App() {
  let selectedId: number | null = null;
  let lastVote = null as ReturnType<typeof vote> | null;
  const stories = getStories();

  const handleVote = optimistic({
    action: (id: number) => vote(id),
    apply: (id, _operationId) => {
      const story = stories.find(it => it.id == id)
      if (story) story.votes++
      return ()=>  stories.forEach(it => { if (it.id == id) it.votes-- })
    },
    reconcile: (saved, _operationId) => {
      stories.forEach(it => { if (it.id == saved.id) it.votes = saved.votes })
    },
  })



  return (
    <Group pending={LocalPending}>
      <main>
        <h1>Fullstack demo</h1>
        <p class="hint">
          The list below is a module source resolved on the server through the
          in-memory server-function dispatch, then hydrated from the payload.
        </p>
        <ul>
          {stories.map((story) => (
            <li key={story.id}>
              <strong>{story.title}</strong> — {story.votes} votes
              <button onClick={() => { selectedId = story.id; }}>Details</button>
              <button onClick={() => { handleVote(story.id)}}>Vote</button>
            </li>
          ))}
        </ul>
        {selectedId !== null && <StoryDetail id={selectedId} />}
        {lastVote !== null && (
          <p class="status">
            {$track(lastVote).pending
              ? 'Recording vote…'
              : $track(lastVote).error !== null
                ? `Vote failed: ${$track(lastVote).error?.message}`
                : `Vote recorded for story #${lastVote.id}`}
          </p>
        )}
      </main>
    </Group>
  );
}



export function LocalPending() {
  return <span class="inline-feedback pending-feedback"><span class="mini-spinner" /> waiting</span>;
}

export function LocalFailure({ error, retry }: ErrorPolicyComponentProps) {
  return <button class="inline-feedback error-feedback" onClick={retry}>{error.message} Retry</button>;
}

function StoryDetail({ id }: { id: number }) {
  const story = getStory(id);
  return (

    <Group pending={LocalPending} error={LocalFailure}>
      <Details story={story}/>
    </Group>
  );
}

function Details({ story }: { story: ReturnType<typeof getStory> }) {
  return (
    <article>
      <h2>{story?.title ?? 'Unknown story'}</h2>
      <p>{story?.summary ?? 'No summary available.'}</p>
      <small>
        This detail source rebinds reactively: changing the selected story
        re-issues only this request.
      </small>
    </article>
  );
}
