export interface FeedItem {
  id: number;
  title: string;
  category: string;
  votes: number;
}

let theme: 'dark' | 'light' = 'dark';
let clicks = 0;
let items: FeedItem[] = [
  { id: 1, title: 'Memoized DOM: Zero-Cost Fine-Grained Reactivity', category: 'Architecture', votes: 42 },
  { id: 2, title: 'Streaming & Settle Coordinator in RFC §16.5', category: 'SSR', votes: 19 },
  { id: 3, title: 'Adopting Keyed Lists Without In-Memory DOM Allocation', category: 'Performance', votes: 88 },
];

function ItemRow(props: { item: FeedItem }) {
  const item = props.item;
  return (
    <li class="feed-item">
      <div class="vote-box">
        <button class="btn-vote" onClick={() => { item.votes++; }}>▲</button>
        <span class="vote-count">{item.votes}</span>
      </div>
      <div class="content">
        <strong class="title">{item.title}</strong>
        <span class="tag">{item.category}</span>
      </div>
    </li>
  );
}

export function SsrAppApp() {
  return (
    <div class={theme === 'dark' ? 'app-shell theme-dark' : 'app-shell theme-light'}>
      <header class="app-header">
        <div class="brand">
          <span class="logo">⚡</span>
          <h1>Universal SSR + Hydration Demo</h1>
        </div>
        <div class="controls">
          <button class="btn" onClick={() => { theme = theme === 'dark' ? 'light' : 'dark'; }}>
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
          <button class="btn btn-primary" onClick={() => { clicks++; }}>
            {`Clicks: ${clicks}`}
          </button>
        </div>
      </header>

      <main class="app-main">
        <section class="panel">
          <h2>Server-Rendered Keyed List (Adopted by Hydration)</h2>
          <ul class="feed-list">
            {items.map((item) => (
              <ItemRow item={item} key={item.id} />
            ))}
          </ul>
          <div class="actions">
            <button class="btn" onClick={() => {
              const nextId = items.length + 1;
              items = [...items, { id: nextId, title: `New Article #${nextId}`, category: 'Dynamic', votes: 0 }];
            }}>
              + Add Item
            </button>
            <button class="btn" onClick={() => {
              items = [...items].reverse();
            }}>
              ⇄ Reverse List
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
