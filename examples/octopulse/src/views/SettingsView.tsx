/**
 * Settings View (`/settings`)
 * 
 * Demonstrates:
 * 1. Programmatic router navigation guards with `blockNavigation` from `@memoized-dom/router`
 * 2. Unsaved changes detection via pure derivations
 * 3. Component-level cleanup ownership (`cleanup(unblock)`)
 * 4. Local reactive form bindings with strict typing
 */

import { blockNavigation } from '@memoized-dom/router';
import { theme, setTheme } from '../state/theme';

export function SettingsView() {
  // Saved baseline values
  let initialClusterName = 'octo-cluster-primary';
  let initialRateLimit = '2500';
  let initialSampleRate = '1000';

  // Current mutable form inputs
  let clusterName = initialClusterName;
  let rateLimit = initialRateLimit;
  let sampleRate = initialSampleRate;
  let saveNotification = '';

  // Pure derived check for dirty form state
  const hasUnsavedChanges = 
    clusterName !== initialClusterName ||
    rateLimit !== initialRateLimit ||
    sampleRate !== initialSampleRate;

  // Install navigation blocker when form has unsaved modifications
  const unblock = blockNavigation(() => {
    if (hasUnsavedChanges) {
      return window.confirm('You have unsaved configuration changes. Are you sure you want to navigate away?');
    }
    return true;
  });

  // Ensure router guard is cleanly unregistered on unmount
  cleanup(unblock);

  function handleSave(e: Event) {
    e.preventDefault();
    initialClusterName = clusterName;
    initialRateLimit = rateLimit;
    initialSampleRate = sampleRate;
    saveNotification = 'Settings saved successfully!';
    setTimeout(() => {
      saveNotification = '';
    }, 3000);
  }

  function handleReset() {
    clusterName = initialClusterName;
    rateLimit = initialRateLimit;
    sampleRate = initialSampleRate;
  }

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
            Cluster & System Settings
          </h1>
          <span className="px-2 py-0.5 rounded bg-surface text-ink-soft border border-line text-xs font-mono">
            Navigation Guard
          </span>
        </div>
        <p className="text-xs text-ink-soft mt-1">
          Configure telemetry rates, cluster identities, and theme preferences.
        </p>
      </div>

      {/* Dirty Changes Warning Banner */}
      <div if={hasUnsavedChanges} className="p-4 rounded-2xl bg-amber-950/40 border border-amber-800/60 text-amber-300 flex items-center justify-between text-xs font-mono">
        <span className="flex items-center gap-2">
          <span>⚠️</span> You have unsaved changes. Navigation is protected by <code className="text-amber-400">blockNavigation</code>.
        </span>
        <span className="font-bold uppercase tracking-wider text-[10px] px-2 py-0.5 rounded bg-amber-900/60 text-amber-200">
          Unsaved
        </span>
      </div>

      <div if={!!saveNotification} className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs font-mono flex items-center gap-2">
        <span>✅</span> {saveNotification}
      </div>

      {/* Settings Form */}
      <form onSubmit={handleSave} className="p-6 sm:p-8 rounded-3xl bg-surface border border-line shadow-2xl space-y-6">
        
        {/* Cluster Name */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-ink-soft font-mono mb-2">
            Cluster Identifier
          </label>
          <input
            value={clusterName}
            onInput={(e: Event) => clusterName = (e.currentTarget as HTMLInputElement).value}
            className="w-full px-4 py-2.5 rounded-xl bg-base border border-line focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-ink text-sm outline-none transition-all font-mono"
          />
          <p className="text-[11px] text-ink-faint mt-1">
            Global unique DNS identity across service mesh.
          </p>
        </div>

        {/* Rate Limiting */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-ink-soft font-mono mb-2">
              Max Rate Limit (req/min)
            </label>
            <input
              type="number"
              value={rateLimit}
              onInput={(e: Event) => rateLimit = (e.currentTarget as HTMLInputElement).value}
              className="w-full px-4 py-2.5 rounded-xl bg-base border border-line focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-ink text-sm outline-none transition-all font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-ink-soft font-mono mb-2">
              Telemetry Sample Rate (ms)
            </label>
            <input
              type="number"
              value={sampleRate}
              onInput={(e: Event) => sampleRate = (e.currentTarget as HTMLInputElement).value}
              className="w-full px-4 py-2.5 rounded-xl bg-base border border-line focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-ink text-sm outline-none transition-all font-mono"
            />
          </div>
        </div>

        {/* Theme Preference Selection */}
        <div className="pt-4 border-t border-line">
          <label className="block text-xs font-bold uppercase tracking-wider text-ink-soft font-mono mb-3">
            Interface Theme Palette
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`p-4 rounded-2xl border text-left transition-all ${
                theme === 'dark'
                  ? 'bg-base border-emerald-500/60 ring-1 ring-emerald-500'
                  : 'bg-base border-line hover:border-line-strong'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-ink">🌙 Warm Obsidian (Dark)</span>
                <span if={theme === 'dark'} className="text-xs text-emerald-400 font-bold">Active</span>
              </div>
              <p className="text-xs text-ink-faint">
                Charcoal forest, emerald, and warm amber accents. Zero blue/violet glare.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`p-4 rounded-2xl border text-left transition-all ${
                theme === 'light'
                  ? 'bg-base border-emerald-500/60 ring-1 ring-emerald-500'
                  : 'bg-base border-line hover:border-line-strong'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-ink">☀️ Crisp Sage (Light)</span>
                <span if={theme === 'light'} className="text-xs text-emerald-400 font-bold">Active</span>
              </div>
              <p className="text-xs text-ink-faint">
                Clean organic paper tone with deep moss contrast.
              </p>
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-line">
          <button
            type="button"
            onClick={handleReset}
            disabled={!hasUnsavedChanges}
            className="px-4 py-2.5 rounded-xl bg-elevated hover:bg-stone-700 disabled:opacity-30 text-ink-soft text-xs font-bold transition-all"
          >
            Reset
          </button>
          <button
            type="submit"
            disabled={!hasUnsavedChanges}
            className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-stone-950 font-bold text-xs shadow-md shadow-emerald-950 transition-all"
          >
            Save Changes
          </button>
        </div>

      </form>

    </main>
  );
}
