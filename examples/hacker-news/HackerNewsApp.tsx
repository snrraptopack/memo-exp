import { Feed } from './Feed';
import { StoryPage } from './StoryPage';

function Header() {
  return (
    <header class="hn-header">
      <a class="y-logo" route-to="/" aria-label="Memoized Hacker News home">Y</a>
      <a class="brand" route-to="/">Memoized News</a>
      <nav aria-label="Primary navigation">
        <a route-to="/newest">new</a>
        <span>|</span>
        <a route-to="/ask">ask</a>
        <span>|</span>
        <a route-to="/show">show</a>
        <span>|</span>
        <a route-to="/jobs">jobs</a>
      </nav>
      <a class="login-link" href="https://news.ycombinator.com/login" target="_blank" rel="noreferrer">
        login
      </a>
    </header>
  );
}

function NotFound() {
  return (
    <main class="not-found">
      <strong>404</strong>
      <p>This route was caught by the compiler-declared <code>/*</code> branch.</p>
      <a route-to="/">return to the front page</a>
    </main>
  );
}

export function HackerNewsApp() {
  return (
    <div class="hn-shell" route="/">
      <Header />
      <Feed route="/" kind="top" heading="Top stories" />
      <Feed route="/newest" kind="newest" heading="Newest stories" />
      <Feed route="/ask" kind="ask" heading="Ask HN" />
      <Feed route="/show" kind="show" heading="Show HN" />
      <Feed route="/jobs" kind="jobs" heading="Jobs" />
      <StoryPage route="/item/:storyId" />
      <NotFound route="/*" />
      <footer class="hn-footer">
        <div class="footer-links">
          <a href="https://news.ycombinator.com/newsguidelines.html" target="_blank" rel="noreferrer">Guidelines</a>
          <span>|</span>
          <a href="https://hn.algolia.com/api" target="_blank" rel="noreferrer">API</a>
          <span>|</span>
          <a href="https://github.com/pyreon/memoized-dom" target="_blank" rel="noreferrer">Memoized DOM</a>
        </div>
        <p>Router regions + data resources, compiled ahead of time.</p>
      </footer>
    </div>
  );
}
