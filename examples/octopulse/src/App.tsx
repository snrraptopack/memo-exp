/**
 * Root Application Component
 * 
 * Demonstrates:
 * 1. Root JSX layout with persistent Navbar and dynamic routing tree
 * 2. Compiler-managed `route` attributes on view components
 * 3. Exact route matching: `/`, `/repos`, `/repo/:owner/:name`, `/tasks`, `/settings`, and `/*`
 */

import { Navbar } from './components/Navbar';
import { DashboardView } from './views/DashboardView';
import { RepoExplorerView } from './views/RepoExplorerView';
import { RepoDetailView } from './views/RepoDetailView';
import { LiveTaskBoardView } from './views/LiveTaskBoardView';
import { SettingsView } from './views/SettingsView';
import { NotFoundView } from './views/NotFoundView';

export function App() {
  return (
    <div className="min-h-screen flex flex-col bg-stone-950 text-stone-100 transition-colors duration-200">
      {/* Global Persistent Header */}
      <Navbar />

      {/* Compiler-Managed Route Tree */}
      <div route="/" className="flex-1">
        <DashboardView route="/" />
        <RepoExplorerView route="/repos" />
        <RepoDetailView route="/repo/:owner/:name" />
        <LiveTaskBoardView route="/tasks" />
        <SettingsView route="/settings" />
        <NotFoundView route="/*" />
      </div>

      {/* Persistent Status Footer */}
      <footer className="border-t border-stone-900/80 bg-stone-950/90 py-6 text-center text-xs text-stone-500 font-mono">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>OctoPulse Command Center · Powered by Memoized DOM Compiler</span>
          <span className="text-emerald-500/80">Direct Real-DOM Updates · Zero VDOM Overhead</span>
        </div>
      </footer>
    </div>
  );
}
