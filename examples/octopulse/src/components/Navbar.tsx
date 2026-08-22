/**
 * Navigation Bar Component
 * 
 * Demonstrates:
 * 1. Declarative navigation using `route-to` directives (string paths & object destinations)
 * 2. Reading shared module state (`theme`, `healthStatusLabel`, `healthColorClass`)
 * 3. Module action dispatching (`toggleTheme`)
 */

import { theme, toggleTheme } from '../state/theme';
import { healthScore, healthStatusLabel, healthColorClass } from '../state/telemetry';

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-stone-800/80 bg-stone-950/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand Logo & Tag */}
        <div className="flex items-center gap-6">
          <a route-to="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-stone-950 font-extrabold text-lg shadow-lg shadow-emerald-950/50 group-hover:scale-105 transition-transform">
              ⚡
            </div>
            <div>
              <span className="text-base font-bold text-stone-100 tracking-tight flex items-center gap-2">
                OctoPulse
                <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-mono">
                  v1.0
                </span>
              </span>
              <span className="text-[11px] text-stone-400 block -mt-0.5">
                Real-Time Engineering Hub
              </span>
            </div>
          </a>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
            <a
              route-to="/"
              className="px-3.5 py-2 rounded-lg text-stone-300 hover:text-stone-100 hover:bg-stone-900 transition-colors"
            >
              Dashboard
            </a>
            <a
              route-to="/repos"
              className="px-3.5 py-2 rounded-lg text-stone-300 hover:text-stone-100 hover:bg-stone-900 transition-colors"
            >
              Live Repositories
            </a>
            <a
              route-to="/tasks"
              className="px-3.5 py-2 rounded-lg text-stone-300 hover:text-stone-100 hover:bg-stone-900 transition-colors"
            >
              Live Task Board
            </a>
            <a
              route-to="/settings"
              className="px-3.5 py-2 rounded-lg text-stone-300 hover:text-stone-100 hover:bg-stone-900 transition-colors"
            >
              Settings
            </a>
          </nav>
        </div>

        {/* Right Section: System Health Badge & Theme Toggle */}
        <div className="flex items-center gap-3">
          
          {/* Real-time Health Derived Indicator */}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border bg-stone-900/60 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-stone-400">Health:</span>
            <span className={`px-1.5 py-0.2 rounded font-semibold ${healthColorClass}`}>
              {healthScore}% ({healthStatusLabel})
            </span>
          </div>

          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg border border-stone-800 bg-stone-900 text-stone-300 hover:text-amber-400 hover:border-amber-700/50 hover:bg-stone-800 transition-all text-sm flex items-center gap-1.5"
            title="Toggle theme (Light / Dark Obsidian)"
          >
            <span>{theme === 'dark' ? '🌙' : '☀️'}</span>
            <span className="hidden lg:inline text-xs font-medium capitalize">{theme}</span>
          </button>
        </div>

      </div>
    </header>
  );
}
