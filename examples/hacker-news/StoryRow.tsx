import { storyDomain, timeAgo } from './api';
import type { HackerNewsHit } from './types';

export function StoryRow({ story, rank }: { story: HackerNewsHit; rank: number }) {
  let points = story.points ?? 0;
  const title = story.title ?? story.story_title ?? 'Untitled discussion';
  const destination = story.url ?? story.story_url;
  const domain = storyDomain(destination);

  function upvote() {
    points++;
  }

  return (
    <li class="story-row">
      <span class="story-rank">{rank}.</span>
      <button class="vote" onClick={upvote} title="upvote" aria-label={`Upvote ${title}`}>
        <span class="vote-triangle" />
      </button>
      <div class="story-copy">
        <div class="story-title-line">
          {destination ? (
            <a class="story-title" href={destination} target="_blank" rel="noreferrer">
              {title}
            </a>
          ) : (
            <a
              class="story-title"
              route-to={{ path: '/item/:storyId', params: { storyId: story.objectID } }}
            >
              {title}
            </a>
          )}
          {domain ? <span class="story-domain">({domain})</span> : null}
        </div>
        <div class="story-meta">
          {points} points by <span class="story-user">{story.author}</span>{' '}
          {timeAgo(story.created_at_i)} <span class="meta-separator">|</span>{' '}
          <a route-to={{ path: '/item/:storyId', params: { storyId: story.objectID } }}>
            {story.num_comments ?? 0} comments
          </a>
        </div>
      </div>
    </li>
  );
}
