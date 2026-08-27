import { $ops, Group, Pending, Error as ErrorArm } from '@memoized-dom/data';
import { feed } from '../session';
import { FeedSkeleton, ErrorFallback } from '../components/Skeletons';

export let searchQuery = '';
export let liveEventsCount = 42;

export function FeedRoute() {
  return (
    <div class="route-container feed-page">
      <div class="page-header">
        <div class="page-title">
          <h2>Live Architecture Stories</h2>
          <p class="subtitle">Streamed keyed list with real-time upvotes and optimistic additions.</p>
        </div>

        <div class="feed-toolbar">
          <button
            class="btn btn-primary"
            onClick={() => {
              $ops(feed).mutate((items) => {
                const nextId = (items?.length ?? 0) + 1;
                items?.unshift({
                  id: nextId,
                  title: `Optimistic Live Update #${nextId}: Declarative JSX Routing & Streamed State`,
                  category: 'Real-Time',
                  author: 'Ada Lovelace',
                  votes: 1,
                  commentsCount: 0,
                  timestamp: 'Just now',
                });
              });
              liveEventsCount += 5;
            }}
          >
            + Publish Story
          </button>
        </div>
      </div>

      <Group data={feed}>
        <Pending component={FeedSkeleton} />
        <ErrorArm component={ErrorFallback} />
        <ul class="stories-list">
          {feed.map((story) => (
            <li class="story-item" key={story.id}>
              <div class="vote-action">
                <button
                  class="btn-vote"
                  onClick={() => {
                    $ops(feed).mutate((items) => {
                      for (const item of items ?? []) {
                        if (item.id === story.id) item.votes++;
                      }
                    });
                    liveEventsCount++;
                  }}
                >
                  ▲
                </button>
                <span class="vote-number">{story.votes}</span>
              </div>
              <div class="story-body">
                <h3 class="story-title">{story.title}</h3>
                <div class="story-meta">
                  <span class="badge category-badge">{story.category}</span>
                  <span class="author">by {story.author}</span>
                  <span class="time">• {story.timestamp}</span>
                  <span class="comments">• 💬 {story.commentsCount} comments</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Group>
    </div>
  );
}
