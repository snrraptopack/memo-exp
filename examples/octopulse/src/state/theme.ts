/**
 * Theme State Management
 * 
 * Demonstrates:
 * 1. Module-level reactive state (`export let theme`)
 * 2. Module-level ambient effect (`effect(...)`) that synchronizes state with the DOM documentElement
 * 3. Derived read-only state (`isDark`)
 */

export type ThemeMode = 'dark' | 'light';

// Initial theme determination (defaulting to dark mode with warm charcoal/emerald palette)
const initialTheme: ThemeMode = 
  typeof window !== 'undefined' && localStorage.getItem('octopulse_theme') === 'light'
    ? 'light'
    : 'dark';

export let theme: ThemeMode = initialTheme;

// Module-level effect runs once and re-runs whenever 'theme' changes.
// No dependency array is used—the compiler detects the read to 'theme'.
effect(() => {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('octopulse_theme', theme);
  }
});

/**
 * Pure derived boolean reflecting current theme.
 * The compiler automatically replays this when 'theme' changes.
 */
export const isDark = theme === 'dark';

/**
 * Action to toggle between light and dark modes.
 */
export function toggleTheme(): void {
  theme = theme === 'dark' ? 'light' : 'dark';
}

/**
 * Action to explicitly set a theme mode.
 */
export function setTheme(mode: ThemeMode): void {
  theme = mode;
}
