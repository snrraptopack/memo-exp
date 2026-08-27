import { route, navigateRoute } from '@memoized-dom/router';
import { Group, Pending, Error as ErrorArm } from '@memoized-dom/data';
import { session } from '../session';
import { AvatarSkeleton, ErrorFallback } from './Skeletons';

export let theme = 'dark';

export function Navbar() {
  const isDark = theme === 'dark';
  const path = route.pathname;

  return (
    <header class="navbar">
      <div class="navbar-left">
        <a
          class="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigateRoute('/');
          }}
        >
          <span class="brand-icon">⚡</span>
          <div class="brand-info">
            <h2>Memoized DOM</h2>
            <span class="badge badge-accent">Universal SSR + Router</span>
          </div>
        </a>

        <nav class="nav-links">
          <a
            class={path === '/' ? 'nav-item active' : 'nav-item'}
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigateRoute('/');
            }}
          >
            📊 Dashboard
          </a>
          <a
            class={path.startsWith('/feed') ? 'nav-item active' : 'nav-item'}
            href="/feed"
            onClick={(e) => {
              e.preventDefault();
              navigateRoute('/feed');
            }}
          >
            📰 Live Feed
          </a>
          <a
            class={path.startsWith('/analytics') ? 'nav-item active' : 'nav-item'}
            href="/analytics"
            onClick={(e) => {
              e.preventDefault();
              navigateRoute('/analytics');
            }}
          >
            📈 Analytics
          </a>
          <a
            class={path.startsWith('/settings') ? 'nav-item active' : 'nav-item'}
            href="/settings"
            onClick={(e) => {
              e.preventDefault();
              navigateRoute('/settings');
            }}
          >
            ⚙️ Settings
          </a>
        </nav>
      </div>

      <div class="navbar-right">
        <button
          class="btn btn-theme"
          onClick={() => {
            theme = isDark ? 'light' : 'dark';
          }}
        >
          {isDark ? '☀️ Light' : '🌙 Dark'}
        </button>

        <div class="session-badge">
          <Group data={session}>
            <Pending component={AvatarSkeleton} />
            <ErrorArm component={ErrorFallback} />
            <div class="user-pill">
              <span class="avatar">{session.avatar}</span>
              <span class="user-name">{session.name}</span>
              <span class="badge badge-sm">{session.role}</span>
            </div>
          </Group>
        </div>
      </div>
    </header>
  );
}
