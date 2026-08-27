import { Navbar, theme } from './components/Navbar';
import { route } from '@memoized-dom/router';
import { DashboardRoute } from './routes/Dashboard';
import { FeedRoute } from './routes/Feed';
import { AnalyticsRoute } from './routes/Analytics';
import { SettingsRoute } from './routes/Settings';

export function SsrAppApp() {
  const isDark = theme === 'dark';
  const path = route.pathname;

  return (
    <div class={isDark ? 'dashboard-shell theme-dark' : 'dashboard-shell theme-light'}>
      <Navbar />

      <main class="main-content">
        {path === '/feed' ? (
          <FeedRoute />
        ) : path === '/analytics' ? (
          <AnalyticsRoute />
        ) : path === '/settings' ? (
          <SettingsRoute />
        ) : (
          <DashboardRoute />
        )}
      </main>
    </div>
  );
}
