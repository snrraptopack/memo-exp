import { createHackerNewsData, loadFeedPage } from './api';
import { StoryRow } from './StoryRow';
import type { FeedKind } from './types';

const MAX_AUTO_PAGES = 12;
const FEED_PAGE_SIZE = 25;

function FeedPage({ kind, page }: { kind: FeedKind; page: number }) {
  const data = createHackerNewsData();
  const stories = loadFeedPage(data, kind, page);
  cleanup(data.clear);

  return (
    <section class="feed-page" data-page={page + 1}>
      {stories.pending && !stories.data ? (
        <ol class="story-list skeleton-list" start={page * FEED_PAGE_SIZE + 1}>
          <li class="story-skeleton"><span /><div><b /><i /></div></li>
          <li class="story-skeleton"><span /><div><b /><i /></div></li>
          <li class="story-skeleton"><span /><div><b /><i /></div></li>
        </ol>
      ) : stories.error && !stories.data ? (
        <div class="feed-message feed-error">
          <strong>Could not load this page.</strong>
          <span>{stories.error.message}</span>
          <button onClick={() => stories.refresh()}>try again</button>
        </div>
      ) : (
        <ol class="story-list" start={page * FEED_PAGE_SIZE + 1}>
          {stories.data?.hits.map((story, index) => (
            <StoryRow
              key={story.objectID}
              story={story}
              rank={page * FEED_PAGE_SIZE + index + 1}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

export function Feed({ kind, heading }: { kind: FeedKind; heading: string }) {
  let pages = [0];
  let loadGate = false;

  function loadMore() {
    if (loadGate || pages.length >= MAX_AUTO_PAGES) return;
    loadGate = true;
    pages = [...pages, pages.length];
    setTimeout(() => {
      loadGate = false;
    }, 900);
  }

  effect(() => {
    const onScroll = () => {
      const remaining = document.documentElement.scrollHeight -
        (window.scrollY + window.innerHeight);
      if (remaining < 560) loadMore();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    const initialCheck = window.setTimeout(onScroll, 500);
    return () => {
      window.clearTimeout(initialCheck);
      window.removeEventListener('scroll', onScroll);
    };
  });

  return (
    <main class="feed" aria-labelledby="feed-heading">
      <div class="feed-heading-row">
        <h1 id="feed-heading">{heading}</h1>
        <span>live data from the Hacker News index</span>
      </div>
      {pages.map(page => <FeedPage key={page} kind={kind} page={page} />)}
      <div class="load-more-row">
        {pages.length < MAX_AUTO_PAGES ? (
          <button class="load-more" onClick={loadMore}>load more stories</button>
        ) : (
          <span class="feed-limit">You reached the end of this demo session.</span>
        )}
      </div>
    </main>
  );
}
